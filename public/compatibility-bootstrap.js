(function () {
  'use strict';

  function installRandomUuidFallback() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') return;
    if (typeof window.crypto.randomUUID === 'function') return;

    var randomUuid = function () {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = [];
      for (var index = 0; index < bytes.length; index += 1) {
        hex.push(bytes[index].toString(16).padStart(2, '0'));
      }
      return hex.slice(0, 4).join('') + '-' +
        hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' +
        hex.slice(8, 10).join('') + '-' +
        hex.slice(10, 16).join('');
    };

    try {
      Object.defineProperty(window.crypto, 'randomUUID', {
        configurable: true,
        value: randomUuid
      });
    } catch (error) {
      window.crypto.randomUUID = randomUuid;
    }
  }

  function missingFeatures() {
    var missing = [];
    if (typeof Promise !== 'function') missing.push('Promise');
    if (typeof fetch !== 'function') missing.push('fetch');
    if (typeof URL !== 'function') missing.push('URL');
    if (typeof URLSearchParams !== 'function') missing.push('URLSearchParams');
    if (typeof AbortController !== 'function') missing.push('AbortController');
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') missing.push('SecureRandom');
    if (typeof Element === 'undefined' || typeof Element.prototype.closest !== 'function') missing.push('Element.closest');
    if (typeof Object.entries !== 'function') missing.push('Object.entries');
    if (typeof String.prototype.normalize !== 'function') missing.push('String.normalize');
    if (typeof window.matchMedia !== 'function') missing.push('matchMedia');
    if (typeof window.requestAnimationFrame !== 'function') missing.push('requestAnimationFrame');
    if (!window.CSS || typeof window.CSS.supports !== 'function' || !window.CSS.supports('display', 'grid')) missing.push('CSS Grid');
    if (!window.CSS || !window.CSS.supports('--astera-test', '0')) missing.push('CSS Variables');
    return missing;
  }

  function renderUnsupported(missing) {
    if (document.getElementById('astera-runtime-unsupported')) return;
    var panel = document.createElement('main');
    panel.id = 'astera-runtime-unsupported';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'inset:0',
      'overflow:auto',
      'box-sizing:border-box',
      'padding:calc(32px + env(safe-area-inset-top,0px)) 22px calc(32px + env(safe-area-inset-bottom,0px))',
      'background:#0a0a0a',
      'color:#fffaf0',
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans JP,sans-serif',
      'display:flex',
      'align-items:center',
      'justify-content:center'
    ].join(';');

    var card = document.createElement('section');
    card.style.cssText = 'width:100%;max-width:620px;border:1px solid #4b4540;border-radius:18px;background:#171512;padding:26px;box-sizing:border-box;line-height:1.8';
    var title = document.createElement('h1');
    title.textContent = 'Asteraを安全に起動できません';
    title.style.cssText = 'margin:0 0 14px;font-size:26px;line-height:1.25';
    var message = document.createElement('p');
    message.textContent = 'この端末のOSまたはWeb表示機能が古いため、画面が消える・ボタンが反応しない状態を避けて停止しました。';
    var android = document.createElement('p');
    android.textContent = 'Android：Google Playで「Android System WebView」とChromeを更新してから、Asteraを開き直してください。';
    var ios = document.createElement('p');
    ios.textContent = 'iPhone／iPad：iOS／iPadOS 15以上へ更新してから、Asteraを開き直してください。';
    var detail = document.createElement('code');
    detail.textContent = '不足機能: ' + missing.join(', ');
    detail.style.cssText = 'display:block;margin-top:16px;padding:12px;border-radius:10px;background:#0a0a0a;color:#d3a15f;overflow-wrap:anywhere;font-size:12px';

    card.appendChild(title);
    card.appendChild(message);
    card.appendChild(android);
    card.appendChild(ios);
    card.appendChild(detail);
    panel.appendChild(card);
    document.body.appendChild(panel);
  }

  installRandomUuidFallback();
  var missing = missingFeatures();
  window.__ASTERA_RUNTIME_UNSUPPORTED__ = missing.length > 0;
  document.documentElement.setAttribute('data-astera-runtime', missing.length ? 'unsupported' : 'supported');

  if (missing.length) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { renderUnsupported(missing); }, { once: true });
    } else {
      renderUnsupported(missing);
    }
  }
})();
