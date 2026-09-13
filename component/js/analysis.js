(function () {
  const WORKER_ENDPOINT = "/api/tracker";

  function safe(fn, fallback = null) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  async function safeAsync(fn, fallback = null) {
    try {
      return await fn();
    } catch (e) {
      return fallback;
    }
  }

  function getCanvasFingerprint() {
    return safe(() => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("fingerprint-test", 2, 15);
      return canvas.toDataURL();
    });
  }

  function getWebGLInfo() {
    return safe(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      const gl2exists = !!canvas.getContext("webgl2");
      if (!gl) return { webgl2Supported: gl2exists };
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        webgl2Supported: gl2exists,
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        extensions: gl.getSupportedExtensions(),
      };
    });
  }

  function getAudioFingerprint() {
    return safe(() => {
      const AudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx(1, 44100, 44100);
      const oscillator = ctx.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.value = 10000;
      const compressor = ctx.createDynamicsCompressor();
      oscillator.connect(compressor);
      compressor.connect(ctx.destination);
      oscillator.start(0);
      ctx.startRendering();
      return {
        sampleRate: ctx.sampleRate,
        state: ctx.state,
        maxChannelCount: safe(() => ctx.destination.maxChannelCount, null),
        baseLatency: safe(() => ctx.baseLatency, null),
      };
    });
  }

  function getFontList() {
    return safe(() => {
      const baseFonts = ["monospace", "sans-serif", "serif"];
      const testFonts = [
        "Meiryo", "MS PGothic", "MS Gothic", "Yu Gothic", "Yu Mincho",
        "Hiragino Kaku Gothic ProN", "Hiragino Mincho ProN",
        "Arial", "Times New Roman", "Courier New", "Comic Sans MS",
        "Verdana", "Georgia", "Impact", "Segoe UI", "Tahoma", "Trebuchet MS",
        "Helvetica Neue", "Noto Sans", "Roboto",
      ];
      const testString = "mmmmmmmmmmlli";
      const span = document.createElement("span");
      span.style.fontSize = "72px";
      span.style.position = "absolute";
      span.style.left = "-9999px";
      span.innerHTML = testString;
      document.body.appendChild(span);

      const baseWidths = {};
      baseFonts.forEach((base) => {
        span.style.fontFamily = base;
        baseWidths[base] = span.offsetWidth;
      });

      const detected = testFonts.filter((font) =>
        baseFonts.some((base) => {
          span.style.fontFamily = `'${font}', ${base}`;
          return span.offsetWidth !== baseWidths[base];
        })
      );

      document.body.removeChild(span);
      return detected;
    }, []);
  }

  function detectAdBlocker() {
    // 広告っぽいクラス名の要素を仕込み、非表示/削除されるかで簡易検出(ダイアログ不要)
    return safe(() => {
      const bait = document.createElement("div");
      bait.className = "adsbox ad-banner ads advertisement";
      bait.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;";
      document.body.appendChild(bait);
      const blocked =
        bait.offsetParent === null ||
        bait.offsetHeight === 0 ||
        getComputedStyle(bait).display === "none";
      document.body.removeChild(bait);
      return blocked;
    }, null);
  }

  async function getPermissionsStatus() {
    // 現在の許可状態を「読むだけ」でダイアログは出ない
    if (!navigator.permissions || !navigator.permissions.query) return null;
    const names = ["geolocation", "notifications", "camera", "microphone", "clipboard-read", "midi", "persistent-storage", "accelerometer", "gyroscope"];
    const result = {};
    for (const name of names) {
      result[name] = await safeAsync(async () => {
        const status = await navigator.permissions.query({ name });
        return status.state;
      }, "unsupported");
    }
    return result;
  }

  async function getMediaDeviceCounts() {
    return safeAsync(async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return null;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const counts = { videoinput: 0, audioinput: 0, audiooutput: 0 };
      devices.forEach((d) => {
        if (counts[d.kind] !== undefined) counts[d.kind]++;
      });
      return counts;
    }, null);
  }

  function getWebRTCLocalIP() {
    return new Promise((resolve) => {
      try {
        const RTCPeerConnection =
          window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
        if (!RTCPeerConnection) return resolve(null);

        const ips = new Set();
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel("");
        pc.onicecandidate = (event) => {
          if (!event.candidate) {
            pc.close();
            resolve(ips.size ? Array.from(ips) : null);
            return;
          }
          const match = event.candidate.candidate.match(
            /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{0,4}(:[a-f0-9]{0,4}){2,7})/
          );
          if (match) ips.add(match[1]);
        };
        pc.createOffer().then((offer) => pc.setLocalDescription(offer));

        setTimeout(() => {
          pc.close();
          resolve(ips.size ? Array.from(ips) : null);
        }, 800);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function collectClientInfo() {
    const nav = navigator;
    const scr = screen;
    const perfNav = safe(() => performance.getEntriesByType("navigation")[0], null);

    const data = {
      // --- 画面・表示関連 ---
      screenWidth: scr.width,
      screenHeight: scr.height,
      availWidth: scr.availWidth,
      availHeight: scr.availHeight,
      availTop: safe(() => scr.availTop, null),
      availLeft: safe(() => scr.availLeft, null),
      colorDepth: scr.colorDepth,
      pixelDepth: scr.pixelDepth,
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      screenX: safe(() => window.screenX, null),
      screenY: safe(() => window.screenY, null),
      scrollX: safe(() => window.scrollX, null),
      scrollY: safe(() => window.scrollY, null),
      orientation: safe(() => screen.orientation?.type, null),
      orientationAngle: safe(() => screen.orientation?.angle, null),
      colorGamut: safe(() => {
        if (matchMedia("(color-gamut: rec2020)").matches) return "rec2020";
        if (matchMedia("(color-gamut: p3)").matches) return "p3";
        if (matchMedia("(color-gamut: srgb)").matches) return "srgb";
        return null;
      }),
      hdr: safe(() => matchMedia("(dynamic-range: high)").matches, null),
      safeAreaInsetTop: safe(() => getComputedStyle(document.documentElement).getPropertyValue("--sat") || null, null),

      // --- 入力デバイス特性(タッチ/マウス判定) ---
      pointerCoarse: safe(() => matchMedia("(pointer: coarse)").matches, null),
      pointerFine: safe(() => matchMedia("(pointer: fine)").matches, null),
      anyHover: safe(() => matchMedia("(any-hover: hover)").matches, null),

      // --- OS/UIの見た目設定 ---
      prefersColorScheme: safe(() => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")),
      prefersReducedMotion: safe(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
      prefersContrast: safe(() => matchMedia("(prefers-contrast: more)").matches),
      forcedColors: safe(() => matchMedia("(forced-colors: active)").matches),

      // --- ロケール・タイムゾーン ---
      language: nav.language,
      languages: nav.languages,
      timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
      timezoneOffset: new Date().getTimezoneOffset(),
      calendar: safe(() => Intl.DateTimeFormat().resolvedOptions().calendar, null),
      numberingSystem: safe(() => Intl.NumberFormat().resolvedOptions().numberingSystem, null),

      // --- デバイス・OS ---
      platform: nav.platform,
      oscpu: safe(() => nav.oscpu, null),
      product: safe(() => nav.product, null),
      productSub: safe(() => nav.productSub, null),
      buildID: safe(() => nav.buildID, null),
      hardwareConcurrency: nav.hardwareConcurrency || null,
      deviceMemory: nav.deviceMemory || null,
      maxTouchPoints: nav.maxTouchPoints || 0,
      vendor: nav.vendor || null,
      appVersion: nav.appVersion || null,
      appCodeName: safe(() => nav.appCodeName, null),
      userAgentDataMobile: safe(() => nav.userAgentData?.mobile, null),
      userAgentDataBrands: safe(() => nav.userAgentData?.brands, null),
      userAgentDataHighEntropy: await safeAsync(async () => {
        if (!nav.userAgentData || !nav.userAgentData.getHighEntropyValues) return null;
        return await nav.userAgentData.getHighEntropyValues([
          "architecture", "bitness", "model", "platformVersion",
          "uaFullVersion", "fullVersionList", "formFactor", "wow64",
        ]);
      }, null),

      // --- ネットワーク情報 ---
      connection: safe(() => {
        const c = nav.connection || nav.mozConnection || nav.webkitConnection;
        return c
          ? { effectiveType: c.effectiveType, downlink: c.downlink, downlinkMax: c.downlinkMax, rtt: c.rtt, saveData: c.saveData, type: c.type }
          : null;
      }),
      onLine: safe(() => nav.onLine, null),
      webrtcLocalIPs: await getWebRTCLocalIP(),

      // --- ブラウザ機能・状態フラグ ---
      cookieEnabled: nav.cookieEnabled,
      doNotTrack: nav.doNotTrack,
      globalPrivacyControl: safe(() => nav.globalPrivacyControl, null),
      pdfViewerEnabled: safe(() => nav.pdfViewerEnabled, null),
      webdriver: nav.webdriver || false,
      pluginsCount: safe(() => nav.plugins.length, 0),
      pluginNames: safe(() => Array.from(nav.plugins).map((p) => p.name), []),
      mimeTypesCount: safe(() => nav.mimeTypes.length, 0),
      notificationPermission: safe(() => window.Notification?.permission ?? null, null), // 状態の読み取りのみ
      geolocationApiExists: safe(() => "geolocation" in nav, null), // 呼び出さず存在確認のみ
      shareApiExists: safe(() => "share" in nav, null), // 呼び出さず存在確認のみ
      serviceWorkerSupported: safe(() => "serviceWorker" in nav, null),
      webAssemblySupported: safe(() => typeof WebAssembly === "object", null),
      sharedArrayBufferSupported: safe(() => typeof SharedArrayBuffer !== "undefined", null),
      broadcastChannelSupported: safe(() => typeof BroadcastChannel !== "undefined", null),
      isSecureContext: safe(() => window.isSecureContext, null),
      crossOriginIsolated: safe(() => window.crossOriginIsolated, null),
      userActivationHasBeenActive: safe(() => nav.userActivation?.hasBeenActive, null),
      userActivationIsActive: safe(() => nav.userActivation?.isActive, null),
      adBlockerDetected: detectAdBlocker(),

      localStorageEnabled: safe(() => {
        localStorage.setItem("__t", "1");
        localStorage.removeItem("__t");
        return true;
      }, false),
      sessionStorageEnabled: safe(() => {
        sessionStorage.setItem("__t", "1");
        sessionStorage.removeItem("__t");
        return true;
      }, false),
      indexedDBEnabled: safe(() => !!window.indexedDB, false),
      storageEstimate: await safeAsync(async () => {
        if (!nav.storage || !nav.storage.estimate) return null;
        const { quota, usage } = await nav.storage.estimate();
        return { quota, usage };
      }, null),

      permissionsStatus: await getPermissionsStatus(),
      mediaDeviceCounts: await getMediaDeviceCounts(),
      speechVoicesCount: safe(() => window.speechSynthesis?.getVoices().length ?? null, null),

      // --- ページ・履歴・ウィンドウ情報 ---
      referrer: document.referrer || null,
      historyLength: history.length,
      currentUrl: location.href,
      protocol: location.protocol,
      characterSet: document.characterSet,
      title: document.title,
      compatMode: document.compatMode,
      readyState: document.readyState,
      hasFocus: safe(() => document.hasFocus(), null),
      visibilityState: document.visibilityState,
      windowName: safe(() => window.name || null, null),
      hasOpener: safe(() => !!window.opener, null),

      // --- パフォーマンス/読み込み時間 ---
      pageLoadTimingMs: safe(() => (perfNav ? Math.round(perfNav.duration) : null), null),
      navigationType: safe(() => perfNav?.type ?? null, null),
      timeOrigin: safe(() => Math.round(performance.timeOrigin), null),
      resourceCount: safe(() => performance.getEntriesByType("resource").length, null),
      memoryInfo: safe(() => {
        return performance.memory
          ? {
              usedJSHeapSize: performance.memory.usedJSHeapSize,
              totalJSHeapSize: performance.memory.totalJSHeapSize,
              jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            }
          : null;
      }, null),

      // --- フィンガープリント系 ---
      canvasFingerprint: getCanvasFingerprint(),
      webgl: getWebGLInfo(),
      audioFingerprint: getAudioFingerprint(),
      detectedFonts: getFontList(),

      collectedAt: new Date().toISOString(),
    };

    return data;
  }

  async function send() {
    const clientInfo = await collectClientInfo();
    fetch(WORKER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clientInfo),
      keepalive: true,
    }).catch(() => {});
  }

  send();
})();
