/* the shop: the live board, the frame swatches, the countdown, and the reserve buttons */
(function () {
  'use strict';

  // the Stripe Payment Link for the $1 reservation. Empty until it exists: the buttons then point at the waitlist
  var RESERVE_URL = 'https://buy.stripe.com/6oUfZhapo0010kzd3B0ZW00';
  // reservations close at 11:59 pm ET on November 30, 2026 (EST is UTC-5)
  var CLOSE = Date.parse('2026-12-01T04:59:59Z');

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var closed = Date.now() > CLOSE;
  document.documentElement.classList.toggle('closed', closed);

  // the reserve buttons: the Payment Link while it's open, the waitlist before it exists or after it closes
  $$('[data-reserve]').forEach(function (a) {
    if (closed) { a.textContent = 'Join the waitlist'; a.href = a.getAttribute('data-wait') || '../#waitlist'; a.classList.add('ghost'); return; }
    if (RESERVE_URL) { a.href = RESERVE_URL; a.rel = 'noopener'; }
    else { a.textContent = 'Join the waitlist'; a.href = a.getAttribute('data-wait') || '../#waitlist'; }
  });
  $$('[data-open]').forEach(function (el) { el.hidden = closed; });
  $$('[data-shut]').forEach(function (el) { el.hidden = !closed; });

  // the closing pill says the date, and goes away once passes close
  var clock = $('#clock');
  if (clock && closed) clock.hidden = true;

  // the live board, drawn the way the real one draws it
  var MB = window.MooBoard, led = $('#shop-board'), hero = $('.shop-hero');
  if (MB && led) {
    var glow = function (c) { if (hero) hero.style.setProperty('--glow', Math.round(c[0]) + ', ' + Math.round(c[1]) + ', ' + Math.round(c[2])); };
    var scenes = (led.getAttribute('data-scenes') || 'say,time,moo').split(',');
    var say = led.getAttribute('data-say');
    new MB.Board(led, { scenes: scenes, say: say ? say.split('|') : null, onGlow: glow });
  }

  // the frame swatches
  var bezel = $('#shop-bezel'), name = $('#frame-name');
  $$('.sw').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('.sw').forEach(function (o) { o.classList.toggle('on', o === b); o.setAttribute('aria-checked', o === b ? 'true' : 'false'); });
      if (bezel) bezel.setAttribute('data-frame', b.getAttribute('data-frame'));
      if (name) name.textContent = b.getAttribute('aria-label');
    });
  });
})();
