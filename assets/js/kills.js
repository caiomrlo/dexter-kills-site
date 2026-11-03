/**
 * Kill dossiers shown when a blood slide is pulled out of the Trophy Box.
 * To add a new kill: drop the photo in assets/img/kills/ and add an entry here.
 * The polaroid frame (assets/img/polaroid-frame.webp) is shared by every kill.
 *
 * - slotIndex: which slide in the box holds this kill (0..12 carry blood)
 * - headline: plain text; wrap the accent word in *asterisks*
 * - photoPosition: CSS object-position used to keep the face inside the polaroid window
 * - photoZoom: optional extra zoom (1 = fit), anchored on photoPosition
 * - photo: null shows an empty polaroid
 * Order here is the order the user steps through (button / scroll down = next).
 */
export const KILLS = [
  {
    slotIndex: 0,
    number: '01',
    name: 'Paul Bennett',
    method: 'Estrangulamento',
    headline: 'O *primeiro* da lista.',
    description:
      'Um predador que escapava da justiça. Paul Bennett foi o primeiro a conhecer o Código de Dexter.',
    episode: 'T01E01 – Dexter',
    photo: 'assets/img/kills/kill-01.webp',
    photoPosition: '39% 22%',
    photoZoom: 1.7
  },
  // PLACEHOLDER: replace with the real victim data and photo
  {
    slotIndex: 1,
    number: '02',
    name: 'Nome da Vítima',
    method: 'Método',
    headline: 'Frase de *destaque*.',
    description: 'Texto provisório. Preencha os dados desta vítima em assets/js/kills.js.',
    episode: 'T00E00 – Título',
    photo: null
  },
  // PLACEHOLDER: replace with the real victim data and photo
  {
    slotIndex: 2,
    number: '03',
    name: 'Nome da Vítima',
    method: 'Método',
    headline: 'Frase de *destaque*.',
    description: 'Texto provisório. Preencha os dados desta vítima em assets/js/kills.js.',
    episode: 'T00E00 – Título',
    photo: null
  }
];
