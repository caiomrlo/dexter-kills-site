/**
 * WebGPU 3D Renderer for Dexter's Blood Slide Box
 * Uses native WebGPU API (navigator.gpu) with WGSL shaders, 4x MSAA,
 * dynamic uniform buffers, and back-to-front depth sorting for the 45 glass slides.
 */

import { WGSL_SHADER } from './shaders.js';
import {
  BOX_SPECS,
  buildFloorMesh,
  buildBaseMesh,
  buildLidMesh,
  buildLatchClaspMesh,
  buildSingleSlideMesh
} from './geometry.js';

const OBJECT_UNIFORM_SIZE = 144; // 2 * mat4 (128B) + vec4 (16B) = 144B
const OBJECT_UNIFORM_STRIDE = 256; // WebGPU minUniformBufferOffsetAlignment = 256 bytes

/**
 * Generates the high-res 2D canvas texture for the lid's inner numbered Index Card (01 - 50)
 * matching Reference Image 2 (top-left and top-right).
 */
function createIndexCardCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');

  // Warm archival cream paper background
  ctx.fillStyle = '#f5f2eb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle paper vignette
  const grad = ctx.createRadialGradient(512, 1024, 200, 512, 1024, 1200);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(180,168,148,0.18)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const marginX = 76;
  const topY = 72;
  const bottomY = canvas.height - 72;
  const rows = 50;
  const rowStep = (bottomY - topY) / rows;

  ctx.strokeStyle = '#9e978e';
  ctx.lineWidth = 2.0;
  ctx.fillStyle = '#332f2c';
  ctx.font = 'bold 24px "Courier New", Courier, monospace';
  ctx.textBaseline = 'bottom';

  for (let i = 1; i <= rows; i++) {
    const y = topY + i * rowStep;

    // Horizontal ruled line
    ctx.beginPath();
    ctx.moveTo(marginX, y);
    ctx.lineTo(canvas.width - marginX, y);
    ctx.stroke();

    // Number on the left column (01 to 50)
    const numStr = i < 10 ? `0${i}` : `${i}`;
    ctx.fillText(numStr, marginX + 6, y - 4);
  }

  // Vertical divider line after the numbers
  ctx.strokeStyle = '#b0a99f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(marginX + 52, topY + rowStep * 0.2);
  ctx.lineTo(marginX + 52, bottomY);
  ctx.stroke();

  return canvas;
}

export class TrophyBoxRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.context = null;
    this.format = null;
    this.sampleCount = 4;

    this.msaaTexture = null;
    this.depthTexture = null;

    // Meshes
    this.floorMesh = null;
    this.baseMesh = null;
    this.lidMesh = null;
    this.claspMesh = null;
    this.slideMesh = null;

    // Total drawable objects:
    // 0: Base mesh (and Floor mesh shares identity transform at slot 0)
    // 1: Lid mesh
    // 2: Latch clasp loop mesh
    // 3..47: 45 Glass slides
    // 48..50: Mirrored floor reflections of Base, Lid, Clasp
    this.reflSlotBase = 3 + BOX_SPECS.numSlides;
    this.maxObjects = this.reflSlotBase + 3;
  }

  async init() {
    if (!navigator.gpu) {
      throw new Error('WebGPU API not available in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });
    if (!adapter) {
      throw new Error('Failed to request WebGPU adapter.');
    }

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied'
    });

    this._createGeometries();
    this._createTextures();
    this._createUniformBuffers();
    this._createPipelines();
    this.resize();
  }

  _uploadMesh(meshData) {
    const vbo = this.device.createBuffer({
      size: meshData.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(vbo.getMappedRange()).set(meshData.vertices);
    vbo.unmap();

    const ibo = this.device.createBuffer({
      size: meshData.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(ibo.getMappedRange()).set(meshData.indices);
    ibo.unmap();

    return {
      vbo,
      ibo,
      indexCount: meshData.indexCount
    };
  }

  _createGeometries() {
    this.floorMesh = this._uploadMesh(buildFloorMesh());
    this.baseMesh = this._uploadMesh(buildBaseMesh());
    this.lidMesh = this._uploadMesh(buildLidMesh());
    this.claspMesh = this._uploadMesh(buildLatchClaspMesh());
    this.slideMesh = this._uploadMesh(buildSingleSlideMesh());
  }

  _createTextures() {
    const cardCanvas = createIndexCardCanvas();
    this.indexCardTexture = this.device.createTexture({
      size: [cardCanvas.width, cardCanvas.height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    this.device.queue.copyExternalImageToTexture(
      { source: cardCanvas },
      { texture: this.indexCardTexture },
      [cardCanvas.width, cardCanvas.height]
    );

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });
  }

  _createUniformBuffers() {
    // Scene uniforms: mat4 viewProj (64B) + vec4 cameraPos (16B) + vec4 params (16B) = 96B
    this.sceneUniformBuffer = this.device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // Dynamic uniform buffer for all objects
    this.objectUniformBuffer = this.device.createBuffer({
      size: this.maxObjects * OBJECT_UNIFORM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.objectStagingData = new Float32Array((this.maxObjects * OBJECT_UNIFORM_STRIDE) / 4);
  }

  _createPipelines() {
    const shaderModule = this.device.createShaderModule({
      code: WGSL_SHADER
    });

    this.sceneBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' }
        }
      ]
    });

    this.objectBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: {
            type: 'uniform',
            hasDynamicOffset: true,
            minBindingSize: OBJECT_UNIFORM_SIZE
          }
        }
      ]
    });

    this.sceneBindGroup = this.device.createBindGroup({
      layout: this.sceneBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.sceneUniformBuffer } },
        { binding: 1, resource: this.indexCardTexture.createView() },
        { binding: 2, resource: this.sampler }
      ]
    });

    this.objectBindGroup = this.device.createBindGroup({
      layout: this.objectBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.objectUniformBuffer,
            offset: 0,
            size: OBJECT_UNIFORM_SIZE
          }
        }
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.sceneBindGroupLayout, this.objectBindGroupLayout]
    });

    const vertexBuffers = [
      {
        arrayStride: 40,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
          { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
          { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
          { shaderLocation: 3, offset: 32, format: 'float32' },   // matId
          { shaderLocation: 4, offset: 36, format: 'float32' }    // extra
        ]
      }
    ];

    const alphaBlend = {
      color: {
        srcFactor: 'src-alpha',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add'
      },
      alpha: {
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add'
      }
    };

    // 0. Studio Floor Shadow Pipeline (drawn first, depthWriteEnabled: false so reflection depth pre-pass works cleanly)
    this.floorPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: vertexBuffers
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: alphaBlend }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none'
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        format: 'depth24plus'
      },
      multisample: {
        count: this.sampleCount
      }
    });

    // 1. Opaque Solid Box Pipeline (writes depth)
    this.solidPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: vertexBuffers
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: alphaBlend }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none'
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
        format: 'depth24plus'
      },
      multisample: {
        count: this.sampleCount
      }
    });

    // 2. Transparent Glass Slide Pipeline (sorted back-to-front)
    this.glassPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: vertexBuffers
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: alphaBlend }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none'
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        format: 'depth24plus'
      },
      multisample: {
        count: this.sampleCount
      }
    });

    // 3. Floor reflection pipelines.
    // 3a. Depth-only pre-pass so only the nearest reflected surface is kept (no stacked translucency)
    this.reflDepthPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shaderModule, entryPoint: 'vs_main', buffers: vertexBuffers },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, writeMask: 0 }]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
      multisample: { count: this.sampleCount }
    });

    // 3b. Faded color pass, only on the surviving (equal-depth) reflected fragments
    this.reflColorPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shaderModule, entryPoint: 'vs_main', buffers: vertexBuffers },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: alphaBlend }]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { depthWriteEnabled: false, depthCompare: 'equal', format: 'depth24plus' },
      multisample: { count: this.sampleCount }
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));

    if (this.canvas.width === width && this.canvas.height === height && this.msaaTexture) {
      return;
    }

    this.canvas.width = width;
    this.canvas.height = height;

    if (this.msaaTexture) this.msaaTexture.destroy();
    if (this.depthTexture) this.depthTexture.destroy();

    this.msaaTexture = this.device.createTexture({
      size: [width, height],
      sampleCount: this.sampleCount,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    this.depthTexture = this.device.createTexture({
      size: [width, height],
      sampleCount: this.sampleCount,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
  }

  _writeObjectUniform(slotIndex, modelMat, slideIdx, hoverAmt, selectAmt, seed) {
    const floatOffset = (slotIndex * OBJECT_UNIFORM_STRIDE) / 4;
    // Model matrix
    this.objectStagingData.set(modelMat, floatOffset);
    // Normal matrix (for rigid body transforms, modelMat works directly)
    this.objectStagingData.set(modelMat, floatOffset + 16);
    // objParams
    this.objectStagingData[floatOffset + 32] = slideIdx;
    this.objectStagingData[floatOffset + 33] = hoverAmt;
    this.objectStagingData[floatOffset + 34] = selectAmt;
    this.objectStagingData[floatOffset + 35] = seed;
  }

  render(sceneState) {
    this.resize();

    // 1. Update Scene Uniforms
    const sceneData = new Float32Array(24);
    sceneData.set(sceneState.viewProjMatrix, 0);
    sceneData[16] = sceneState.cameraPos[0];
    sceneData[17] = sceneState.cameraPos[1];
    sceneData[18] = sceneState.cameraPos[2];
    sceneData[19] = 1.0;
    sceneData[20] = sceneState.lidOpenProgress;
    sceneData[21] = sceneState.time;
    sceneData[22] = sceneState.hoveredSlide;
    sceneData[23] = sceneState.selectedSlide;
    this.device.queue.writeBuffer(this.sceneUniformBuffer, 0, sceneData);

    // 2. Write Object Uniforms:
    // Slot 0: Base (and Floor)
    this._writeObjectUniform(0, sceneState.baseMatrix, -1, 0, 0, 0);
    // Slot 1: Lid
    this._writeObjectUniform(1, sceneState.lidMatrix, -1, 0, 0, 0);
    // Slot 2: Clasp Loop
    this._writeObjectUniform(2, sceneState.claspMatrix, -1, 0, 0, 0);

    // Mirrored floor reflections (seed = -1 flags the reflection path in the shaders)
    this._writeObjectUniform(this.reflSlotBase + 0, sceneState.baseMatrix, -1, 0, 0, -1);
    this._writeObjectUniform(this.reflSlotBase + 1, sceneState.lidMatrix, -1, 0, 0, -1);
    this._writeObjectUniform(this.reflSlotBase + 2, sceneState.claspMatrix, -1, 0, 0, -1);

    // Slots 3..47: 45 Slides
    const slideOrder = [];
    const camZ = sceneState.cameraPos[2];
    const camX = sceneState.cameraPos[0];
    const camY = sceneState.cameraPos[1];

    for (let i = 0; i < BOX_SPECS.numSlides; i++) {
      const s = sceneState.slides[i];
      const slotIdx = 3 + i;
      this._writeObjectUniform(
        slotIdx,
        s.modelMatrix,
        i,
        s.hoverProgress,
        s.selectProgress,
        i + 1.0
      );

      const dx = s.worldPos[0] - camX;
      const dy = s.worldPos[1] - camY;
      const dz = s.worldPos[2] - camZ;
      const distSq = dx * dx + dy * dy + dz * dz;
      slideOrder.push({ slotIdx, distSq });
    }

    // Sort transparent slides back-to-front relative to camera position
    slideOrder.sort((a, b) => b.distSq - a.distSq);

    // Upload all object uniforms in one batch
    this.device.queue.writeBuffer(this.objectUniformBuffer, 0, this.objectStagingData);

    // 3. Record Render Pass
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.msaaTexture.createView(),
          resolveTarget: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    });

    renderPass.setBindGroup(0, this.sceneBindGroup);

    // Pass 1: Studio Floor Ambient & Lateral Shadows (does not write depth)
    renderPass.setPipeline(this.floorPipeline);
    renderPass.setBindGroup(1, this.objectBindGroup, [0 * OBJECT_UNIFORM_STRIDE]);
    renderPass.setVertexBuffer(0, this.floorMesh.vbo);
    renderPass.setIndexBuffer(this.floorMesh.ibo, 'uint32');
    renderPass.drawIndexed(this.floorMesh.indexCount);

    // Pass 2: Glossy Mirrored Floor Reflection (depth pre-pass + faded/blurred color pass)
    const reflMeshes = [this.baseMesh, this.lidMesh, this.claspMesh];
    for (const pipeline of [this.reflDepthPipeline, this.reflColorPipeline]) {
      renderPass.setPipeline(pipeline);
      for (let m = 0; m < reflMeshes.length; m++) {
        renderPass.setBindGroup(1, this.objectBindGroup, [(this.reflSlotBase + m) * OBJECT_UNIFORM_STRIDE]);
        renderPass.setVertexBuffer(0, reflMeshes[m].vbo);
        renderPass.setIndexBuffer(reflMeshes[m].ibo, 'uint32');
        renderPass.drawIndexed(reflMeshes[m].indexCount);
      }
    }

    // Pass 3: Solid Meshes (Base, Lid, Latch Clasp)
    renderPass.setPipeline(this.solidPipeline);

    // Base (Slot 0)
    renderPass.setBindGroup(1, this.objectBindGroup, [0 * OBJECT_UNIFORM_STRIDE]);
    renderPass.setVertexBuffer(0, this.baseMesh.vbo);
    renderPass.setIndexBuffer(this.baseMesh.ibo, 'uint32');
    renderPass.drawIndexed(this.baseMesh.indexCount);

    // Lid (Slot 1)
    renderPass.setBindGroup(1, this.objectBindGroup, [1 * OBJECT_UNIFORM_STRIDE]);
    renderPass.setVertexBuffer(0, this.lidMesh.vbo);
    renderPass.setIndexBuffer(this.lidMesh.ibo, 'uint32');
    renderPass.drawIndexed(this.lidMesh.indexCount);

    // Latch Clasp Loop (Slot 2)
    renderPass.setBindGroup(1, this.objectBindGroup, [2 * OBJECT_UNIFORM_STRIDE]);
    renderPass.setVertexBuffer(0, this.claspMesh.vbo);
    renderPass.setIndexBuffer(this.claspMesh.ibo, 'uint32');
    renderPass.drawIndexed(this.claspMesh.indexCount);

    // Pass 4: 45 Glass Slides sorted back-to-front
    renderPass.setPipeline(this.glassPipeline);
    renderPass.setVertexBuffer(0, this.slideMesh.vbo);
    renderPass.setIndexBuffer(this.slideMesh.ibo, 'uint32');

    for (let i = 0; i < slideOrder.length; i++) {
      const slotIdx = slideOrder[i].slotIdx;
      renderPass.setBindGroup(1, this.objectBindGroup, [slotIdx * OBJECT_UNIFORM_STRIDE]);
      renderPass.drawIndexed(this.slideMesh.indexCount);
    }

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}
