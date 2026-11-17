var c = document.getElementById("c"), g = c.getContext("2d");
var t = 0;
setInterval(function () {
  t += 0.05;
  g.fillStyle = "#101820"; g.fillRect(0, 0, 320, 320);
  g.fillStyle = "#ffc93c"; g.fillRect(140 + Math.sin(t) * 90, 140, 40, 40);
}, 16);
