/**
 * Kill dossiers shown when a blood slide is pulled out of the Trophy Box.
 * To add a new kill: drop the photo in assets/img/kills/ and add an entry here.
 * Each kill belongs to a series (see SERIES below): it picks the polaroid frame,
 * the small logo above the dossier and the tint of the background haze.
 *
 * - series: 'new-blood' | 'resurrection'
 * - season / episodeNumber / episodeTitle: where the kill happens ('episode' is the label shown in the dossier)
 * - killNumber: Dexter's official kill count on the wiki (null when not tracked)
 * - blood: what happened to the blood slide
 * - photo: assets/img/kills/<series>/<NN>-[sX-]<victim-name>.jpg
 * - slotIndex: which slide in the box holds this kill (0..12 carry blood)
 * - headline: plain text; wrap the accent word in *asterisks*
 * - photoPosition: CSS object-position used to keep the face inside the polaroid window
 * - photoZoom: optional extra zoom (1 = fit), anchored on photoPosition
 * - photo: null shows an empty polaroid
 * Order here is the order the user steps through (button / scroll down = next).
 */
export const SERIES = {
  'new-blood': {
    title: 'Dexter: New Blood',
    frame: 'assets/img/series/frame-new-blood.webp',
    logo: 'assets/img/series/logo-new-blood.png'
  },
  resurrection: {
    title: 'Dexter: Resurrection',
    frame: 'assets/img/series/frame-resurrection.webp',
    logo: 'assets/img/series/logo-resurrection.png'
  }
};

export const KILLS = [
  {
    slotIndex: 0,
    series: 'new-blood',
    number: '01',
    season: 1,
    episodeNumber: 1,
    episodeTitle: 'Cold Snap',
    episode: 'T01E01 – Cold Snap',
    killNumber: null,
    name: 'Matt Caldwell',
    method: 'Faca de caça no peito',
    blood: 'Lâmina de sangue improvisada, descartada junto aos restos.',
    headline: 'A *primeira* em dez anos.',
    description:
      'Playboy arrogante de Wall Street que deixou um rastro de mortos num acidente de barco. Dexter, como Jim Lindsay, quebra dez anos de abstinência para matá-lo na floresta de Iron Lake.',
    photo: 'assets/img/kills/new-blood/01-matt-caldwell.jpg',
    photoPosition: '40% 15%',
    photoZoom: 2.2
  },
  {
    slotIndex: 1,
    series: 'new-blood',
    number: '02',
    season: 1,
    episodeNumber: 5,
    episodeTitle: 'Runaway',
    episode: 'T01E05 – Runaway',
    killNumber: null,
    name: 'Jasper Hodge',
    method: 'Overdose forçada de fentanil',
    blood: 'Nenhum sangue coletado.',
    headline: 'Veneno *vendido* em pílulas.',
    description:
      'Traficante descuidado cujas pílulas adulteradas quase mataram Harrison. Dexter o dopa, o confronta com os mortos e é interrompido pelo Sargento Logan, mas Jasper ainda morre de overdose forçada.',
    photo: 'assets/img/kills/new-blood/02-jasper-hodge.jpg',
    photoPosition: '50% 40%',
    photoZoom: 1
  },
  {
    slotIndex: 2,
    series: 'new-blood',
    number: '03',
    season: 1,
    episodeNumber: 8,
    episodeTitle: 'Unfair Game',
    episode: 'T01E08 – Unfair Game',
    killNumber: null,
    name: 'Elric Kane',
    method: 'Faca de cozinha no peito',
    blood: 'Nenhum sangue coletado.',
    headline: 'Caçador *caçado*.',
    description:
      'Capanga contratado por Kurt Caldwell para eliminar Dexter. Depois de sequestrá-lo e atirar em sua perna, Elric segue as pegadas de sangue até cair na própria armadilha.',
    photo: 'assets/img/kills/new-blood/03-elric-kane.jpg',
    photoPosition: '47% 20%',
    photoZoom: 1.9
  },
  {
    slotIndex: 3,
    series: 'new-blood',
    number: '04',
    season: 1,
    episodeNumber: 9,
    episodeTitle: 'The Family Business',
    episode: 'T01E09 – The Family Business',
    killNumber: null,
    name: 'Kurt Caldwell',
    method: 'Faca no peito',
    blood: 'Nenhum sangue coletado.',
    headline: 'Um pai e seu *bunker*.',
    description:
      'Magnata local e serial killer que atraía vítimas para um bunker em forma de motel e as matava com um rifle pelas costas. Pai de Matt, descobre quem matou o filho e enfrenta Dexter no confronto final.',
    photo: 'assets/img/kills/new-blood/04-kurt-caldwell.jpg',
    photoPosition: '50% 30%',
    photoZoom: 1.2
  },
  {
    slotIndex: 4,
    series: 'new-blood',
    number: '05',
    season: 1,
    episodeNumber: 10,
    episodeTitle: 'Sins of the Father',
    episode: 'T01E10 – Sins of the Father',
    killNumber: null,
    name: 'Sargento Logan',
    method: 'Pescoço quebrado em mata-leão',
    blood: 'Nenhum sangue coletado.',
    headline: 'Um *acidente* inevitável.',
    description:
      'Policial simpático de Iron Lake, mas peça do esquema de Kurt. Ao tentar desviar da bala de Logan, Dexter acaba quebrando seu pescoço num mata-leão: uma morte sem premeditação.',
    photo: 'assets/img/kills/new-blood/05-sergeant-logan.jpg',
    photoPosition: '55% 25%',
    photoZoom: 1.4
  },
  {
    slotIndex: 5,
    series: 'resurrection',
    number: '06',
    season: 1,
    episodeNumber: 3,
    episodeTitle: 'Backseat Driver',
    episode: 'T01E03 – Backseat Driver',
    killNumber: 152,
    name: 'Ronald Schmidt',
    method: 'Faca no peito',
    blood: 'Nenhum sangue coletado.',
    headline: 'Motoristas de app *no alvo*.',
    description:
      'Técnico de segurança cibernética que culpava os motoristas de aplicativo pela ruína do pai e matou sete deles. Dexter o intercepta na estrada, e sua identidade é usada depois por Gareth.',
    photo: 'assets/img/kills/resurrection/01-s1-ronald-schmidt.jpg',
    photoPosition: '52% 35%',
    photoZoom: 1.2
  },
  {
    slotIndex: 6,
    series: 'resurrection',
    number: '07',
    season: 1,
    episodeNumber: 4,
    episodeTitle: 'Call Me Red',
    episode: 'T01E04 – Call Me Red',
    killNumber: 153,
    name: 'Lowell Sloane',
    method: 'Esfaqueado com a própria faca de esfolar',
    blood: 'Lâmina improvisada: a primeira da Terceira Caixa, deixada por cima das outras por não caber.',
    headline: 'O *colecionador* de tatuagens.',
    description:
      'Anestesista que virou assassino e guarda a pele tatuada de suas vítimas. Membro do clube de Leon Prater, é morto por Dexter com a própria faca de esfolar.',
    photo: 'assets/img/kills/resurrection/02-s1-lowell-sloane.jpg',
    photoPosition: '50% 22%',
    photoZoom: 1.5
  },
  {
    slotIndex: 7,
    series: 'resurrection',
    number: '08',
    season: 1,
    episodeNumber: 6,
    episodeTitle: 'Cats and Mouse',
    episode: 'T01E06 – Cats and Mouse',
    killNumber: 154,
    name: 'Gêmeo de Gareth',
    method: 'Faca de cozinha no peito',
    blood: 'Segunda lâmina, compartilhada com o irmão.',
    headline: 'Metade de um *Gêmeos*.',
    description:
      'Um dos irmãos por trás do lendário Gemini, que se revezavam como um só assassino. Dexter o elimina e segue na caça pelo outro gêmeo.',
    photo: 'assets/img/kills/resurrection/03-s1-gareths-twin.jpg',
    photoPosition: '50% 40%',
    photoZoom: 1.1
  },
  {
    slotIndex: 8,
    series: 'resurrection',
    number: '09',
    season: 1,
    episodeNumber: 7,
    episodeTitle: 'Course Correction',
    episode: 'T01E07 – Course Correction',
    killNumber: 155,
    name: 'Gareth Pike',
    method: 'Taça de vinho quebrada no pescoço',
    blood: 'Segunda lâmina, compartilhada com o irmão, com sangue retirado do vidro quebrado.',
    headline: 'A outra *metade*.',
    description:
      'O gêmeo sobrevivente do Gemini morre com a própria taça quebrada cravada no pescoço, numa cena armada para parecer legítima defesa.',
    photo: 'assets/img/kills/resurrection/04-s1-gareth-pike.jpg',
    photoPosition: '50% 22%',
    photoZoom: 1.5
  },
  {
    slotIndex: 9,
    series: 'resurrection',
    number: '10',
    season: 1,
    episodeNumber: 10,
    episodeTitle: 'And Justice For All...',
    episode: 'T01E10 – And Justice For All...',
    killNumber: 156,
    name: 'Leon Prater',
    method: 'Faca dobrável no peito',
    blood: 'Nenhum sangue coletado dele, mas a primeira caixa de lâminas foi recuperada de sua coleção de troféus.',
    headline: 'O *anfitrião* da noite.',
    description:
      'Bilionário que organizava o clube secreto de serial killers e guardava troféus de suas vítimas. Dexter encerra o jogo e recupera a primeira caixa de lâminas.',
    photo: 'assets/img/kills/resurrection/05-s1-leon-prater.jpg',
    photoPosition: '62% 20%',
    photoZoom: 1.7
  },
  {
    slotIndex: 10,
    series: 'resurrection',
    number: '11',
    season: 2,
    episodeNumber: 1,
    episodeTitle: 'Risky Business',
    episode: 'T02E01 – Risky Business',
    killNumber: 166,
    name: 'Emmett Bell',
    method: 'Machadinha no peito',
    blood: '12ª lâmina de sangue.',
    headline: 'O *Mutilador* da meia-noite.',
    description:
      'Matava as vítimas à meia-noite depois de duas semanas quebrando seus ossos, um a um. Primeiro alvo de Dexter na caçada ao clube de Prater, em Seattle.',
    photo: 'assets/img/kills/resurrection/06-s2-emmett-bell.jpg',
    photoPosition: '50% 15%',
    photoZoom: 1.8
  },
  {
    slotIndex: 11,
    series: 'resurrection',
    number: '12',
    season: 2,
    episodeNumber: 1,
    episodeTitle: 'Risky Business',
    episode: 'T02E01 – Risky Business',
    killNumber: 167,
    name: 'R.H. Martin',
    method: 'Faca no peito',
    blood: '13ª lâmina de sangue.',
    headline: 'O *Carrasco* de Yonkers.',
    description:
      'Satanista que montava altares com as vítimas e jurava que o diabo mandou. Dexter o prende a um cano e responde que é fácil culpar outro por seus atos.',
    photo: 'assets/img/kills/resurrection/07-s2-rh-martin.jpg',
    photoPosition: '73% 22%',
    photoZoom: 1.8
  },
  {
    slotIndex: 12,
    series: 'resurrection',
    number: '13',
    season: 2,
    episodeNumber: 1,
    episodeTitle: 'Risky Business',
    episode: 'T02E01 – Risky Business',
    killNumber: 168,
    name: 'Al Walker',
    method: 'Enforcado com corrente de guincho',
    blood: '14ª lâmina de sangue.',
    headline: 'Pai de família, *assassino* de elite.',
    description:
      'Pai de quatro filhos, bem-humorado, que estrangulou ao menos 18 mulheres e fornecia rabos de cavalo para a coleção de Prater. Dexter o enforca com uma corrente de guincho.',
    photo: 'assets/img/kills/resurrection/08-s2-al-walker.jpg',
    photoPosition: '50% 25%',
    photoZoom: 1.3
  }
];
