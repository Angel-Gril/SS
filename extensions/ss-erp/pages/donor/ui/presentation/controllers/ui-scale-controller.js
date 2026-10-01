export function createUiScaleController({
  rootId: resolvedValue1 = "ui-scale-root",
  designWidth: resolvedValue2 = 1440,
  designHeight: resolvedValue3 = 960,
  safeMargin: resolvedValue4 = 8,
  maxScale: resolvedValue5 = 1.45
} = {}) {
  let flagValue4 = false;
  let localValue5 = null;
  function helperFn() {
    return document.getElementById(resolvedValue1);
  }
  function helperFn2() {
    const helperValue2 = helperFn();
    if (!helperValue2) {
      return 1;
    }
    const maxResult6 = Math.max(window.innerWidth || 0, 320);
    const maxResult7 = Math.max(window.innerHeight || 0, 320);
    const maxResult8 = Math.max(1, maxResult6 - resolvedValue4 * 2);
    const maxResult9 = Math.max(1, maxResult7 - resolvedValue4 * 2);
    const minResult10 = Math.min(maxResult8 / resolvedValue2, maxResult9 / resolvedValue3, resolvedValue5);
    helperValue2.style.width = maxResult6 / minResult10 + "px";
    helperValue2.style.height = maxResult7 / minResult10 + "px";
    helperValue2.style.zoom = String(minResult10);
    helperValue2.style.transform = "";
    return minResult10;
  }
  return {
    init: function () {
      if (flagValue4) {
        helperFn2();
        return;
      }
      flagValue4 = true;
      const helperValue3 = () => {
        requestAnimationFrame(() => {
          helperFn2();
        });
      };
      helperValue3();
      window.addEventListener("resize", helperValue3);
      window.visualViewport?.addEventListener("resize", helperValue3);
      if (typeof ResizeObserver == "function") {
        localValue5 = new ResizeObserver(helperValue3);
        localValue5.observe(document.documentElement);
      }
    },
    applyScale: helperFn2,
    getScale: function () {
      const helperValue4 = helperFn();
      if (!helperValue4) {
        return 1;
      }
      const localValue11 = helperValue4.style.zoom || window.getComputedStyle(helperValue4).zoom || "";
      const parseFloatResult = parseFloat(localValue11);
      if (Number.isFinite(parseFloatResult) && parseFloatResult > 0) {
        return parseFloatResult;
      }
      const localValue12 = helperValue4.style.transform || window.getComputedStyle(helperValue4).transform || "";
      if (!localValue12 || localValue12 === "none") {
        return 1;
      }
      const matchResult13 = localValue12.match(/scale\(([^)]+)\)/);
      if (matchResult13) {
        return parseFloat(matchResult13[1]) || 1;
      }
      const matchResult14 = localValue12.match(/matrix\(([^,]+),/);
      return matchResult14 && parseFloat(matchResult14[1]) || 1;
    }
  };
}
