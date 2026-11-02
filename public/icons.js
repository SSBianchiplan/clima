/* =============================================================================
   ÍCONES — conjunto próprio de ícones de linha (grade 24×24, traço 1,8, pontas
   redondas), no lugar dos emojis. Seguem a cor do texto e o tema claro/escuro.
   · Ico(nome, tamanho)  → <svg> para a interface
   · IcoPaint(ctx, nome|emoji, cx, cy, tamanho, cor) → desenha no canvas (marcadores do mapa)
   · Botões, chips, itens de menu e títulos que começam com um emoji ganham o ícone
     correspondente automaticamente (observador do DOM), sem mexer em cada tela.
   ============================================================================= */
(() => {
"use strict";
const c = (x, y, r) => `M${x-r} ${y}a${r} ${r} 0 1 0 ${2*r} 0a${r} ${r} 0 1 0 ${-2*r} 0z`;
// nome → [caminhos] ; nomes em FILL são preenchidos em vez de contornados
const P = {
  sun:["M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4", c(12,12,4)],
  moon:["M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"],
  contrast:[c(12,12,9), "M12 3v18"],
  search:[c(11,11,7), "M20.5 20.5l-4.6-4.6"],
  pin:["M12 21s-7-6.3-7-11.5a7 7 0 0 1 14 0C19 14.7 12 21 12 21z", c(12,9.5,2.5)],
  menu:["M4 6.5h16M4 12h16M4 17.5h16"],
  city:["M3 21h18M5 21V9l6-3v15M11 21V3.5l8 4V21M14 10h2M14 13.5h2M14 17h2M7.5 12h1.5M7.5 15.5h1.5"],
  mountain:["M2.5 20l7-12 4.2 7 2.6-4.3 5.2 9.3z"],
  altbands:["M2.5 20l7-12 4.2 7 2.6-4.3 5.2 9.3z","M5.2 15.4h6.3M3.6 18.1h16.8M13.7 15.4h3.9M7.8 11h3.3"],   // faixas de altitude
  finerelief:["M2.5 17.5 8 8.5l2.6 4.3","M2.5 17.5h5",c(15.5,14.5,5),"M19.1 18.1l2.4 2.4","M12.3 16.6l2.1-3 1.5 1.8 1.1-1.3 1.8 2.5"],   // relevo na lupa
  drone:[c(5.5,5.5,2.7),c(18.5,5.5,2.7),c(5.5,18.5,2.7),c(18.5,18.5,2.7),"M9.6 9.6h4.8v4.8H9.6zM7.4 7.4l2.2 2.2M16.6 7.4l-2.2 2.2M7.4 16.6l2.2-2.2M16.6 16.6l-2.2-2.2"],
  compass:[c(12,12,9), "M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"],
  check:["M5 12.5l4.5 4.5L19 7.5"],
  checkc:[c(12,12,9), "M8 12.3l2.8 2.8L16.2 9.6"],
  x:["M6 6l12 12M18 6L6 18"],
  plane:["M12 2.5c.8 0 1.5.7 1.5 1.5v5l7.5 4.5v2l-7.5-2.3v4.3l2 1.5v1.5L12 19.6 8.5 20.5V19l2-1.5v-4.3L3 15.5v-2L10.5 9V4c0-.8.7-1.5 1.5-1.5z"],
  takeoff:["M3 20.5h18M4.5 14.5l2.5 1 11.5-5c1-.4 1.4-1.5 1-2.4-.4-.8-1.4-1.2-2.3-.8L13.5 9 7 6.5 5.5 7.2l4.3 3.6-3.4 1.5-2.2-1.3-1.2.6z"],
  landing:["M3 20.5h18M5 9.5l1.3-1 2.2 1.7 3.5-.7L9.5 4.3 11 4l5 5.6 4.1.8c.9.2 1.5 1.1 1.3 2-.2.9-1.1 1.4-2 1.2L6.6 11.2z"],
  map:["M9 4L3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20"],
  landmark:["M3 21h18M4.5 18h15M5 10h14M12 3l8 5H4zM6.5 10v8M10 10v8M14 10v8M17.5 10v8"],
  book:["M4 19.5V5a2 2 0 0 1 2-2h14v14H6a2 2 0 0 0-2 2.5zM4 19.5A2 2 0 0 0 6 21h14v-4"],
  wind:["M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"],
  vol:["M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"],
  vollow:["M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6"],
  mute:["M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5"],
  globe:[c(12,12,9), "M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9M12 3C9.5 5.5 8.2 8.5 8.2 12s1.3 6.5 3.8 9"],
  video:["M3 7.5A1.5 1.5 0 0 1 4.5 6h10A1.5 1.5 0 0 1 16 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 16.5zM16 10.5l5-3v9l-5-3"],
  alert:["M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5v.01"],
  volcano:["M2.5 21l6-10h7l6 10zM8.5 11l1.6 2.6 1.9-1.6 1.9 1.6 1.6-2.6M10.5 8c-.5-1.8.5-3 2-3.2 1.2-.2 1.7-1.2 1.5-2.3M14.5 7.5c.7-.8 2-1 3-.4"],
  download:["M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"],
  umbrella:["M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v6.5a2 2 0 0 1-4 0M12 2v1"],
  rain:["M7 15a4.5 4.5 0 1 1 1.2-8.8A6 6 0 0 1 19.5 9a3.5 3.5 0 0 1-.7 6.9zM8.5 18.5l-1 2.2M12.5 18.5l-1 2.2M16.5 18.5l-1 2.2"],
  trophy:["M8 4h8v5a4 4 0 0 1-8 0zM8 5.5H5v1.5A3.5 3.5 0 0 0 8 10.4M16 5.5h3v1.5a3.5 3.5 0 0 1-3 3.4M12 13v3.5M9 20.5h6M10 16.5h4v4h-4z"],
  pencil:["M15.5 4.5l4 4L9 19H5v-4zM13.5 6.5l4 4"],
  stadium:["M3 9c0-1.7 4-3 9-3s9 1.3 9 3v6c0 1.7-4 3-9 3s-9-1.3-9-3zM3 9c0 1.7 4 3 9 3s9-1.3 9-3M7 11.6v5.6M17 11.6v5.6M12 12v6"],
  tag:["M3 12.5v-8A1.5 1.5 0 0 1 4.5 3h8l8.5 8.5-9 9z", c(8,8,1.4)],
  box3d:["M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"],
  clock:[c(12,12,9), "M12 7v5l3.2 2"],
  bike:[c(5.5,16,3.5), c(18.5,16,3.5), "M5.5 16l3.8-7h5.7l3.5 7M9.3 9l3.2 7H5.5M13.5 6h2.5l-1 3"],
  traffic:["M8.5 2.5h7A1.5 1.5 0 0 1 17 4v16a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20V4a1.5 1.5 0 0 1 1.5-1.5z", c(12,7,1.6), c(12,12,1.6), c(12,17,1.6)],
  flag:["M5 21V3.5M5 4h12l-2.5 4.5L17 13H5"],
  surf:["M5 19C5 11.5 10.5 5 19 5c0 8.5-6.5 14-14 14zM8.5 15.5l7-7"],
  ff:["M4 6l8 6-8 6zM12 6l8 6-8 6z"],
  sparkle:["M12 3c.6 5 3.9 8.4 9 9-5.1.6-8.4 3.9-9 9-.6-5.1-3.9-8.4-9-9 5.1-.6 8.4-4 9-9z"],
  satellite:["M6.5 11.5l5-5 6 6-5 5zM9 9L4.5 4.5M15 15l4.5 4.5M4.5 4.5L3 6l3 3 1.5-1.5M19.5 19.5L18 21l-3-3 1.5-1.5M15.5 3.5a5 5 0 0 1 5 5M15.5 6.5a2 2 0 0 1 2 2"],
  home:["M3 11l9-7.5 9 7.5M5 9.5V20h5v-6h4v6h5V9.5"],
  wheat:["M12 21V8M12 8C9.8 8 8.5 6.6 8.5 4.5 10.7 4.5 12 5.9 12 8zM12 8c2.2 0 3.5-1.4 3.5-3.5C13.3 4.5 12 5.9 12 8zM12 12.5c-2.2 0-3.5-1.4-3.5-3.5 2.2 0 3.5 1.4 3.5 3.5zM12 12.5c2.2 0 3.5-1.4 3.5-3.5-2.2 0-3.5 1.4-3.5 3.5zM12 17c-2.2 0-3.5-1.4-3.5-3.5 2.2 0 3.5 1.4 3.5 3.5zM12 17c2.2 0 3.5-1.4 3.5-3.5-2.2 0-3.5 1.4-3.5 3.5z"],
  shield:["M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"],
  star:["M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"],
  walk:[c(13,4.5,1.8), "M10 21l2-6.5 2.5 2.5V21M12 14.5l1-5.5-3 1.5L8.5 13M13 9l2.5 3 2.5 1"],
  refresh:["M20 11.5A8 8 0 1 0 17.7 17M20 5v6.5h-6.5"],
  bell:["M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"],
  car:["M4.5 17v-4.5l2-5.3A1.5 1.5 0 0 1 7.9 6h8.2a1.5 1.5 0 0 1 1.4 1.2l2 5.3V17M3.5 17h17M4.5 12.5h15M6 17v2.5h2.5V17M15.5 17v2.5H18V17", c(8,14.8,.9), c(16,14.8,.9)],
  train:["M7 3.5h10a2 2 0 0 1 2 2V15a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 15V5.5a2 2 0 0 1 2-2zM5 10.5h14M9 21l1.5-3.5M15 21l-1.5-3.5", c(8.5,14,.9), c(15.5,14,.9)],
  kite:["M12 2.5l6 7-6 10-6-10zM6 9.5h12M12 2.5v17M12 19.5c-1 1.5-2.5 2-4 2"],
  waves:["M2.5 8c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5M2.5 13c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5M2.5 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5"],
  rocket:["M14.5 4.5c2.5-1.3 4.5-1.5 5.5-1.5 0 1-.2 3-1.5 5.5L13 14l-3-3zM10 11l-4 .5-2.5 2.5 4.5 1M13 14l-.5 4-2.5 2.5-1-4.5M6.5 17.5c-1 1-1.5 2.5-1.5 3.5 1 0 2.5-.5 3.5-1.5", c(15.5,8.5,1.4)],
  gamepad:["M7.5 8h9a4.5 4.5 0 0 1 4.4 5.5l-.8 3.6a2.2 2.2 0 0 1-3.7 1L14.5 16h-5l-1.9 2.1a2.2 2.2 0 0 1-3.7-1l-.8-3.6A4.5 4.5 0 0 1 7.5 8zM8 11v3M6.5 12.5h3M15.5 11.5v.01M17.5 13.5v.01"],
  target:[c(12,12,9), c(12,12,5), c(12,12,1)],
  ruler:["M3 16.5L16.5 3 21 7.5 7.5 21zM7 12.5l1.5 1.5M10 9.5l2 2M13 6.5l1.5 1.5"],
  layers:["M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5"],
  settings:[c(12,12,3), "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"],
  link:["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  camera:["M4 7.5h3l1.5-2.5h7L17 7.5h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z", c(12,13,3.5)],
  church:["M12 2.5v4M10 4.5h4M12 6.5l5 4V21H7V10.5zM3 21h18M4 21v-6l3-2M20 21v-6l-3-2M10.5 21v-4a1.5 1.5 0 0 1 3 0v4"],
  tree:["M12 21v-5M12 16c-4 0-6.5-2-6.5-5 0-2.5 2-3.5 3-3.5C8.5 5 10 3 12 3s3.5 2 3.5 4.5c1 0 3 1 3 3.5 0 3-2.5 5-6.5 5z"],
  beach:["M3.5 20.5h17M12 20.5c0-6 1-10 4-13M16 7.5c-3-2-7-1.5-9 1 3-.5 6 0 9-1zM16 7.5c2-1 4.5-.5 5.5 1.5-2-.5-4-.3-5.5-1.5zM16 7.5c.5-2 2.5-3.5 4.5-3"],
  theater:["M4 4.5c3 1 6 1 9 0V10c0 3-2 5.5-4.5 5.5S4 13 4 10zM11 13.5c1 .3 2 .5 3 .5 2.5 0 4.5-2.5 4.5-5.5V8c-1.8.6-3.6.8-5.5.6M6.5 8.5v.01M10.5 8.5v.01M7 11.5c.8.7 2.2.7 3 0"],
  food:["M7 3v7a2 2 0 0 0 4 0V3M9 10v11M17 21V3c-2 1-3 3.5-3 6.5V13h3"],
  coffee:["M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c-.5 1 .5 2 0 3M12 3.5c-.5 1 .5 2 0 3"],
  bed:["M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6", c(6.8,11,1.7)],
  hospital:["M4 21V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5V21M3 21h18M12 8.5v6M9 11.5h6M10 21v-3.5h4V21"],
  ball:[c(12,12,9), "M12 7.5l3.8 2.8-1.5 4.4H9.7l-1.5-4.4zM12 3v4.5M15.8 10.3l4.5-1.5M14.3 14.7l2.8 3.8M9.7 14.7l-2.8 3.8M8.2 10.3L3.7 8.8"],
  bag:["M5 8h14l-1 13H6zM9 8V6.5a3 3 0 0 1 6 0V8"],
  grad:["M2.5 9L12 4.5 21.5 9 12 13.5zM6.5 11v4.5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3V11M21.5 9v5"],
  telescope:["M4 13.5l12-6 1.5 3-12 6zM16 7.5l3.5-1.7 1.5 3-3.5 1.7M10 15l-2.5 6M11 15l2.5 6"],
  monument:["M9 21V8l3-5 3 5v13M6 21h12M10.5 12h3M10.5 16h3"],
  swapv:["M8 4v16M8 4L4.5 7.5M8 4l3.5 3.5M16 20V4M16 20l-3.5-3.5M16 20l3.5-3.5"],
  swaph:["M4 8h16M4 8l3.5-3.5M4 8l3.5 3.5M20 16H4M20 16l-3.5-3.5M20 16l-3.5 3.5"],
  play:["M7 4.5v15l12.5-7.5z"],
  pause:["M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"],
  stop:["M6 6h12v12H6z"],
  playpause:["M4 5v14l8-7zM15 5v14M19 5v14"],
  full:["M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"],
  clapper:["M4 10h16v10H4zM4 10l1-5h15l-1 5M9 5l-1.5 5M14 5l-1.5 5M19 5l-1.5 5"],
  drop:["M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3z"],
  fire:["M12 21.5c-3.7 0-6.5-2.6-6.5-6.2 0-3.3 2.2-5.3 3.6-7.6.3 1.7 1 2.8 2.1 3.4.2-3.2 1.6-5.9 4-8.6.4 3.1 1.4 4.8 2.6 6.6 1 1.5 1.7 3.3 1.7 5.2 0 4-3 7.2-7.5 7.2zM12 21.5c-1.6 0-2.8-1.2-2.8-2.8 0-1.8 1.4-2.9 2.6-4.3.5 1.1 1.2 1.7 2 2.2.6.5 1 1.2 1 2.1 0 1.6-1.2 2.8-2.8 2.8z"],
  road:["M8 3L4 21M16 3l4 18M12 4v3M12 10.5v3M12 17v3"],
  thermo:["M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0zM12 9v7"],
  dollar:["M16 7c-.5-1.5-2-2.5-4-2.5-2.5 0-4 1.3-4 3s1.5 2.6 4 3.2 4 1.6 4 3.3-1.5 3-4 3c-2.2 0-3.6-1-4.1-2.6M12 2.5v19"],
  sail:["M11 3v14H4zM13 6c3.5 2.5 5.5 6 6 11h-6zM3 19.5c1.5 1 3 1.5 4.5 1.5s3-.5 4.5-1.5c1.5 1 3 1.5 4.5 1.5s3-.5 4.5-1.5"],
  parachute:["M3 11a9 9 0 0 1 18 0zM3 11l9 7 9-7M8 11l4 7 4-7M10.5 18h3v3h-3z"],
  balloon:["M12 16c-3.5 0-6-3.2-6-7a6 6 0 0 1 12 0c0 3.8-2.5 7-6 7zM12 16l-1 1.5h2zM12 17.5c0 2-1 3-2 4"],
  swim:["M2.5 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5M7 14l4.5-4 3 2.5 3-2.5M9.5 6.5l3.5 3", c(17,7.5,1.8)],
  fish:["M3 12c3-4 8-5 12-3l4-3v12l-4-3c-4 2-9 1-12-3zM14.5 11v.01"],
  dive:["M3 9h18v5a2 2 0 0 1-2 2h-4l-3-2.5L9 16H5a2 2 0 0 1-2-2zM20 9V4"],
  canoe:["M2.5 13.5h19c-1 3.5-4.5 5.5-9.5 5.5s-8.5-2-9.5-5.5zM8 4l8 13"],
  skate:["M3 13h18M5 13c0-1 .5-2 2-2h10c1.5 0 2 1 2 2", c(7,16.5,1.6), c(17,16.5,1.6)],
  glider:["M2.5 12.5l9.5-2 9.5 2M12 10.5V16M10 16h4M12 7.5v3"],
  ufo:["M3 13c0-1.7 4-3 9-3s9 1.3 9 3-4 3-9 3-9-1.3-9-3zM8 10.5a4 4 0 0 1 8 0M7 18.5l-1 2M17 18.5l1 2M12 19v2"],
  flask:["M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10"],
  send:["M3 11l18-8-8 18-2-8z"],
  grid:["M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z"],
  burst:["M12 3l1.5 5 4.5-2.5-2 4.5 5 1.5-5 1.5 2 4.5-4.5-2.5L12 21l-1.5-5-4.5 2.5 2-4.5L3 12.5 8 11 6 6.5l4.5 2.5z"],
  up:["M12 19V5M5.5 11.5L12 5l6.5 6.5"], down:["M12 5v14M5.5 12.5L12 19l6.5-6.5"],
  left:["M19 12H5M11.5 5.5L5 12l6.5 6.5"], right:["M5 12h14M12.5 5.5L19 12l-6.5 6.5"],
  chevu:["M6 15l6-6 6 6"], chevd:["M6 9l6 6 6-6"], chevl:["M15 6l-6 6 6 6"], chevr:["M9 6l6 6-6 6"],
  diamond:["M12 6l6 6-6 6-6-6z"],
  bridge:["M2 15.5h20M4 15.5V20M20 15.5V20M2 12c4.5-4.5 15.5-4.5 20 0M7 11.6v3.9M12 10.3v5.2M17 11.6v3.9"],
  bus:["M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V17H5zM5 11h14M5 7h14M7.5 20v-3M16.5 20v-3", "M7.5 14h.01M16.5 14h.01"],
  plus:["M12 5v14M5 12h14"], minus:["M5 12h14"],
  dot:[c(12,12,5)],
  type:["M4.5 7V5h15v2M12 5v14M9 19h6"],
  heli:["M3 6h18M12 6v3M6.5 9h7.5a5 5 0 0 1 0 10H9a3.5 3.5 0 0 1-3.5-3.5V9zM14 19l1.5 2.5M8 19l-1.5 2.5"]
};
const FILL = new Set(["play","pause","stop","dot"]);
// emoji → ícone (mesmo significado)
const E = {
  "☀":"sun","☼":"sun","☀︎":"sun","☾":"moon","◐":"contrast","🔍":"search","⌕":"search","📍":"pin","📌":"pin","☰":"menu",
  "🏙":"city","🏢":"city","🏘":"city","⛰":"mountain","🧭":"compass","✓":"check","✅":"checkc","✕":"x","✈":"plane","🛩":"plane",
  "🛫":"takeoff","🛬":"landing","🗺":"map","🏛":"landmark","📖":"book","💨":"wind","🔊":"vol","🔈":"vollow","🔇":"mute",
  "🌍":"globe","🌐":"globe","🎥":"video","⚠":"alert","🌋":"volcano","🔥":"fire","⬇":"download","☔":"rain","🏆":"trophy","✎":"pencil",
  "🏟":"stadium","🏷":"tag","▦":"box3d","🕑":"clock","⏱":"clock","🚲":"bike","🚦":"traffic","🏁":"flag","🚩":"flag","🏄":"surf",
  "⏩":"ff","✦":"sparkle","🛰":"satellite","🏠":"home","🏡":"home","🌾":"wheat","🛡":"shield","★":"star","🚶":"walk",
  "↻":"refresh","🔁":"refresh","🔔":"bell","🚗":"car","🚇":"train","🪁":"kite","🌊":"waves","🚀":"rocket","🎮":"gamepad",
  "🎯":"target","◎":"target","📏":"ruler","▤":"layers","⚙":"settings","🔗":"link","📸":"camera","⛪":"church","🌳":"tree",
  "🏖":"beach","🎭":"theater","🍽":"food","☕":"coffee","🛏":"bed","🏨":"bed","🏥":"hospital","⚽":"ball","🛍":"bag","🎓":"grad",
  "🔭":"telescope","🗿":"monument","⇅":"swapv","⇄":"swaph","▶":"play","■":"stop","⏯":"playpause","⛶":"full","🎬":"clapper",
  "💧":"drop","🛣":"road","🌡":"thermo","💲":"dollar","⛵":"sail","🪂":"parachute","🎈":"balloon","🏊":"swim","🎣":"fish",
  "🤿":"dive","🛶":"canoe","🚣":"canoe","🛹":"skate","🦅":"glider","🪽":"glider","🛸":"ufo","⚗":"flask","➤":"send","💥":"burst",
  "⬆":"up","⬅":"left","➡":"right","▲":"up","▼":"down","◀":"left","▾":"chevd","▴":"chevu","🔸":"diamond","🟢":"dot","❚❚":"pause"
};
const COLOR = {"🟢":"#34C759"};
function Ico(name, size=18, extra=""){
  const p = P[name]; if(!p) return "";
  const fill = FILL.has(name);
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${p.map(d => `<path d="${d}"/>`).join("")}</svg>`;
}
// desenha o ícone no canvas (marcadores do mapa): centro (cx, cy), lado "size" px
function IcoPaint(g, key, cx, cy, size, color="#fff", lw=2.2){
  const name = P[key] ? key : E[key] || E[String(key).replace(/️/g, "")]; const p = P[name]; if(!p || typeof Path2D === "undefined") return false;
  g.save(); g.translate(cx - size/2, cy - size/2); g.scale(size/24, size/24);
  g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = lw * 24/size; g.strokeStyle = color; g.fillStyle = color;
  for(const d of p){ const path = new Path2D(d); if(FILL.has(name)) g.fill(path); else g.stroke(path); }
  g.restore(); return true;
}

/* ---------- troca automática na interface ---------- */
const KEYS = Object.keys(E).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const LEAD = new RegExp(`^(\\s*)(${KEYS.join("|")})\\ufe0f?\\s*`);
const SEL = "button,a.mbtn,a.xbtn,.chip,.lq,.ci,.pl-ic,summary,h3,h4,label,.rt-h b,.seg button,.rt-opt small,.sh-btns button,.kpi small,.mtitle,.sp-k small,.ck,.cam-ctl button";
const SKIP = "#shTitle,#shNav,#shScore,#shMsg,#shThrT,#rnTxt,#rnDist,#tlRead,.maplibregl-ctrl,input,textarea,select,svg";
function fixEl(el){
  if(el.closest(SKIP)) return;
  // primeiro nó de texto não vazio do elemento
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {acceptNode: n => n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP});
  const t = w.nextNode(); if(!t || t.parentElement?.closest("svg")) return;
  const m = t.nodeValue.match(LEAD); if(!m) return;
  const key = m[2], name = E[key]; if(!name) return;
  // só troca se o emoji é o começo do conteúdo visível do elemento (nada antes dele)
  const r = document.createRange(); r.setStart(el, 0); r.setEnd(t, 0); if(r.toString().trim()) return;
  const rest = t.nodeValue.slice(m[0].length);
  const span = document.createElement("span"); span.className = "ico-w" + (rest.trim() ? " ico-t" : "");
  span.innerHTML = Ico(name, 18, COLOR[key] ? ` style="color:${COLOR[key]}"` : "");
  t.parentNode.insertBefore(span, t);
  t.nodeValue = rest;
}
let pend = new Set(), raf = 0;
function flush(){ raf = 0; const list = pend; pend = new Set();
  for(const n of list){ if(!n.isConnected) continue; if(n.matches?.(SEL)) fixEl(n); n.querySelectorAll?.(SEL).forEach(fixEl); } }
function queue(n){ if(n.nodeType === 3) n = n.parentElement; if(!n || n.nodeType !== 1) return; pend.add(n); if(!raf) raf = requestAnimationFrame(flush); }
function start(){
  queue(document.body);
  new MutationObserver(ms => { for(const m of ms){ if(m.type === "characterData") queue(m.target); else m.addedNodes.forEach(queue); } })
    .observe(document.body, {childList:true, subtree:true, characterData:true});
}
if(document.body) start(); else document.addEventListener("DOMContentLoaded", start);
window.Ico = Ico; window.IcoPaint = IcoPaint; window.IcoName = k => E[k] || E[String(k).replace(/️/g, "")] || null;
})();
