/* Primeiro quadro já no layout novo: aplica as classes de tela antes de o resto da página desenhar
   (sem isso, numa recarga sem cache aparecia o cabeçalho e o menu antigos até o layout.js rodar). */
(function(){
  var b = document.body, h = location.hash, desk = matchMedia("(min-width: 861px)").matches;
  var V = {"#home":"home","#sat":"sat","#agro":"agro","#ops":"ops","#lab":"lab","#pred":"pred","#mar":"mar","#vento":"vento","#viagem":"viagem"};
  var v = V[h] || (h.length > 1 ? "painel" : "home");
  b.dataset.view = v;
  if(v === "sat" || (v === "home" && desk)) b.classList.add("mapview");
  if(v === "sat"){ b.classList.add("widgets-off", "lv2"); if(desk) b.classList.add("side-off"); }
  if(desk) b.classList.add("lv-r");
})();
