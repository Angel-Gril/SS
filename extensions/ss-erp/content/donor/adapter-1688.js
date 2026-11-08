(() => {
  let skuSourceType = 'dom';

  // 诊断：把 adapter 的执行轨迹写进 DOM，主 world 可读（ISOLATED console 抓不到）
  function adapterDiag(msg) {
    try {
      var el = document.documentElement;
      var prev = el.getAttribute('data-adapter-diag') || '';
      el.setAttribute('data-adapter-diag', (prev + ' >> ' + String(msg)).slice(-1500));
    } catch (_e) {}
  }
  async function scrape1688Product() {
    skuSourceType = 'dom';
    let cpShopName = '';
    let cpLeafCategory = '';
    let productName = readText(".title-text") || readText("h1.title") || readText("#mod-detail-title .d-title") || readText("#productTitle .title-content") || readText(".module-od-title .title-content") || readText(".title-content") || document.title || "Untitled";
    const sourceCategoryPath = function (arg3 = "") {
      return function (arg4) {
        const arrayList = [".breadcrumb", ".breadcrumb-wrapper", ".bread-crumb", ".breadCrumb", ".od-breadcrumb", ".od-header-breadcrumb", "[class*='breadcrumb']", "[class*='Breadcrumb']", "[class*='bread-crumb']"];
        for (const local5 of arrayList) {
          for (const local6 of document.querySelectorAll(local5)) {
            const extractedValue1 = normalizeCategoryPath(local6?.innerText || local6?.textContent || "", arg4);
            if (isValidCategoryPath(extractedValue1)) {
              return extractedValue1;
            }
            const extractedValue2 = normalizeCategoryPath([...local6.querySelectorAll("a,span,li")].map(arg5 => arg5?.innerText || arg5?.textContent || "").filter(Boolean).join(" > "), arg4);
            if (isValidCategoryPath(extractedValue2)) {
              return extractedValue2;
            }
          }
        }
        return "";
      }(arg3) || function (arg6) {
        for (const local7 of document.querySelectorAll("script[type=\"application/ld+json\"]")) {
          try {
            const extractedValue3 = findBreadcrumbPathInJsonLd(JSON.parse(local7.textContent || "{}"), arg6);
            if (isValidCategoryPath(extractedValue3)) {
              return extractedValue3;
            }
          } catch {}
        }
        return "";
      }(arg3) || function (arg7) {
        const arrayList2 = [window.__INIT_DATA__, window.__INITIAL_DATA__, window.detailData, window.__GLOBAL_DATA__, window.__offerDetailData];
        for (const local8 of arrayList2) {
          try {
            const extractedValue4 = findCategoryPathInData(typeof local8 == "string" ? JSON.parse(local8) : local8, arg7, 0);
            if (isValidCategoryPath(extractedValue4)) {
              return extractedValue4;
            }
          } catch {}
        }
        return "";
      }(arg3) || function (arg8) {
        const arrayList3 = ["categoryPath", "category_path", "categoryNamePath", "catPath", "breadcrumb", "breadCrumb", "leafCategoryName", "leaf_category_name", "categoryName", "catName"];
        for (const local9 of document.querySelectorAll("script:not([src])")) {
          const local10 = local9.textContent || "";
          if (/category|leafCategoryName|catName|breadcrumb|breadCrumb/i.test(local10)) {
            for (const local11 of arrayList3) {
              const extractedValue5 = normalizeCategoryPath(extractStringFieldFromScript(local10, local11), arg8);
              if (isValidCategoryPath(extractedValue5)) {
                return extractedValue5;
              }
            }
          }
        }
        return "";
      }(arg3) || "";
    }(productName);
    let featureRows = function () {
      const featureRowsDraft = [];
      document.querySelectorAll(".offer-attr-item").forEach(arg9 => {
        const extractedValue6 = readChildText(arg9, ".offer-attr-item-name");
        const extractedValue7 = readChildText(arg9, ".offer-attr-item-value");
        if (extractedValue6 && extractedValue7) {
          featureRowsDraft.push({
            name: extractedValue6,
            value: extractedValue7
          });
        }
      });
      if (featureRowsDraft.length > 0) {
        return featureRowsDraft;
      } else {
        document.querySelectorAll(".cpv-list .cpv-item").forEach(arg10 => {
          const extractedValue8 = readChildText(arg10, ".cpv-item-info-subtitle");
          const extractedValue9 = readChildText(arg10, ".cpv-item-info-title");
          if (extractedValue8 && extractedValue9) {
            featureRowsDraft.push({
              name: extractedValue8,
              value: extractedValue9
            });
          }
        });
        if (!(featureRowsDraft.length > 0)) {
          document.querySelectorAll("#productAttributes table tr").forEach(arg11 => {
            const local12 = arg11.querySelectorAll("th");
            const local13 = arg11.querySelectorAll("td");
            for (let loopCounter0 = 0; loopCounter0 < Math.min(local12.length, local13.length); loopCounter0 += 1) {
              const local14 = local12[loopCounter0]?.innerText?.trim();
              const local15 = local13[loopCounter0]?.innerText?.trim();
              if (local14 && local15) {
                featureRowsDraft.push({
                  name: local14,
                  value: local15
                });
              }
            }
          });
        }
        return featureRowsDraft;
      }
    }();
    let mainImages = uniqueTruthy(function () {
      const mainImageCandidates = [];
      [".detail-gallery-img", ".img-list-wrapper .detail-gallery-img", "#gallery img", ".od-gallery-turn-item-wrapper img", ".od-scroller-item .v-image-cover"].forEach(arg12 => {
        document.querySelectorAll(arg12).forEach(arg13 => {
          const extractedValue11 = normalizeImageUrl(arg13.getAttribute("data-lazy-src") || arg13.getAttribute("data-src") || arg13.getAttribute("data-lazyload-src") || arg13.getAttribute("src") || arg13.style?.backgroundImage || arg13.getAttribute("style") || "");
          const extractedValue12 = getImageContext(arg13, arg12);
          if (extractedValue11) {
            if (!shouldRejectImage(extractedValue11, extractedValue12, {
              requireProductContext: true
            })) {
              if (function (arg14, arg15) {
                const local16 = String(arg14 || "").toLowerCase();
                const local17 = arg15 || {};
                const local18 = ((local17.selector || "") + " " + (local17.text || "")).toLowerCase();
                const local19 = Number(local17.width) || 0;
                const local20 = Number(local17.height) || 0;
                return !!local16 && !/(placeholder|default|empty|upload|camera|video|play|icon|sprite|watermark|占位|默认|上传|视频|播放)/i.test(local18) && (!!/\/img\/ibank\//i.test(local16) || !!/-0-cib\.(?:jpg|jpeg|png|webp)(?:$|[?#])/i.test(local16) || !/https?:\/\/(?:img|cbu01)\.alicdn\.com\/(?:imgextra|cms\/upload)\//i.test(local16) && !!/(gallery|thumb|thumbnail|carousel|scroller|booth|sku|spec|offer|主图|通用图)/i.test(local18) && !!(local19 >= 240) && !!(local20 >= 240));
              }(extractedValue11, extractedValue12)) {
                mainImageCandidates.push(extractedValue11);
              }
            }
          }
        });
      });
      return uniqueTruthy(mainImageCandidates);
    }());
    adapterDiag('before-detailImages');
    const detailImages = await async function (arg16) {
      const local22 = new Set(arg16 || []);
      return uniqueTruthy([...collectLegacyDetailImages(local22), ...collectDetailImagesFromContainers(local22), ...collectIframeDetailImages(local22)].filter(arg17 => !local22.has(arg17)));
    }(mainImages);
    adapterDiag('after-detailImages n=' + detailImages.length);
    const descriptionText = function (arg18) {
      const descriptionFragments = [];
      document.querySelectorAll([".content-detail", ".detail-description-content", "#detail", ".offer-detail-description", ".module-wap-detail", ".detail-content", ".rich-text-description", ".od-detail-container", ".detail-tab-content", ".detail-desc-decorate-richtext"].join(",")).forEach(arg19 => {
        descriptionFragments.push(extractVisibleText(arg19));
      });
      const extractedValue13 = querySelectorAcrossShadowRoots("#detail");
      if (extractedValue13) {
        descriptionFragments.push(extractVisibleText(extractedValue13));
      }
      const local23 = uniqueTruthy(descriptionFragments).map(arg20 => normalizeText(arg20)).filter(arg21 => arg21 && normalizeCompactText(arg21) !== normalizeCompactText(arg18));
      const extractedValue14 = normalizeText(local23.join(" "));
      if (extractedValue14.length >= 24) {
        return extractedValue14.slice(0, 2000);
      } else {
        return arg18;
      }
    }(productName);
    const videoUrls = function () {
      const videoUrlCandidates = [];
      document.querySelectorAll("video, source").forEach(arg22 => {
        [arg22.getAttribute("src"), arg22.getAttribute("data-src"), arg22.getAttribute("data-video-src"), arg22.currentSrc, arg22.src].forEach(arg23 => {
          const extractedValue15 = normalizeUrl(arg23);
          if (extractedValue15 && isVideoUrl(extractedValue15)) {
            videoUrlCandidates.push(extractedValue15);
          }
        });
      });
      ["[data-video-src]", "[data-video-url]", "[data-src*='.mp4']", "[data-src*='.m3u8']", "[data-src*='.flv']", "a[href*='.mp4']", "a[href*='.m3u8']", "a[href*='.flv']"].forEach(arg24 => {
        document.querySelectorAll(arg24).forEach(arg25 => {
          [arg25.getAttribute("data-video-src"), arg25.getAttribute("data-video-url"), arg25.getAttribute("data-src"), arg25.getAttribute("href")].forEach(arg26 => {
            const extractedValue16 = normalizeUrl(arg26);
            if (extractedValue16 && isVideoUrl(extractedValue16)) {
              videoUrlCandidates.push(extractedValue16);
            }
          });
        });
      });
      document.querySelectorAll("script").forEach(arg27 => {
        videoUrlCandidates.push(...function (arg28, arg29 = window.location.href) {
          const arrayList8 = [];
          [/https?:\\\/\\\/[^"'\\\s<>]+?\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)(?:\?[^"'\\\s<>]*)?/gi, /https?:\/\/[^"'\\\s<>]+?\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)(?:\?[^"'\\\s<>]*)?/gi, /\/\/[^"'\\\s<>]+?\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)(?:\?[^"'\\\s<>]*)?/gi].forEach(arg30 => {
            let local24 = arg30.exec(arg28);
            while (local24) {
              const extractedValue17 = normalizeUrl(local24[0], arg29);
              if (extractedValue17 && isVideoUrl(extractedValue17)) {
                arrayList8.push(extractedValue17);
              }
              local24 = arg30.exec(arg28);
            }
            arg30.lastIndex = 0;
          });
          return uniqueTruthy(arrayList8);
        }(String(arg27.textContent || "")));
      });
      return uniqueTruthy(videoUrlCandidates);
    }();
    const packagingInfo = function () {
      const packagingDefaults = {
        weight_g: null,
        length_mm: null,
        width_mm: null,
        height_mm: null
      };
      const packagingRows = [];
      const packagingSourceRows = [];
      document.querySelectorAll(".od-pc-offer-table table, #productPackInfo table").forEach(arg31 => {
        const arrayList11 = [...arg31.querySelectorAll("thead tr")];
        const local25 = arrayList11.length > 0 ? [...arrayList11[arrayList11.length - 1].querySelectorAll("th,td")].map(arg32 => normalizeCompactText(arg32.innerText)) : [];
        [...arg31.querySelectorAll("tbody tr, tr")].forEach(arg33 => {
          const local26 = [...arg33.querySelectorAll("th,td")].map(arg34 => String(arg34.innerText || "").trim()).filter(Boolean);
          if (local26.length === 0) {
            return;
          }
          if (local25.length > 0 && local26.length === local25.length && local26.length > 1) {
            local25.forEach((arg35, arg36) => {
              addPackagingRow(packagingSourceRows, packagingRows, arg35, local26[arg36]);
            });
            return;
          }
          if (local26.length >= 2) {
            addPackagingRow(packagingSourceRows, packagingRows, local26[0], local26[1]);
            return;
          }
          const helperResult7 = function (arg37) {
            const local27 = String(arg37 || "").trim();
            if (!local27) {
              return null;
            }
            const local28 = local27.match(/^(.+?)[\uFF1A:]\s*(.+)$/);
            if (local28) {
              return {
                label: local28[1],
                value: local28[2]
              };
            } else {
              return null;
            }
          }(local26[0]);
          if (helperResult7) {
            addPackagingRow(packagingSourceRows, packagingRows, helperResult7.label, helperResult7.value);
          }
        });
      });
      document.querySelectorAll(".offer-attr-item").forEach(arg38 => {
        addPackagingRow(packagingSourceRows, packagingRows, readChildText(arg38, ".offer-attr-item-name"), readChildText(arg38, ".offer-attr-item-value"));
      });
      document.querySelectorAll(".cpv-list .cpv-item").forEach(arg39 => {
        addPackagingRow(packagingSourceRows, packagingRows, readChildText(arg39, ".cpv-item-info-subtitle"), readChildText(arg39, ".cpv-item-info-title"));
      });
      document.querySelectorAll("#productAttributes table tr").forEach(arg40 => {
        const local29 = [...arg40.querySelectorAll("th,td")].map(arg41 => String(arg41.innerText || "").trim()).filter(Boolean);
        if (local29.length >= 2) {
          addPackagingRow(packagingSourceRows, packagingRows, local29[0], local29[1]);
        }
      });
      packagingSourceRows.forEach(({
        label: value18,
        value: value19
      }) => {
        applyPackagingMeasurement(packagingDefaults, value18, value19);
      });
      (function (arg42, arg43) {
        if (arg42.length_mm != null && arg42.width_mm != null && arg42.height_mm != null) {
          return;
        }
        const local30 = arg43.find(({
          label: value20,
          value: value21
        }) => {
          const extractedValue22 = normalizeCompactText(value20);
          return /(?:\u5c3a\u5bf8|\u957f\u5bbd\u9ad8)/.test(extractedValue22) && !/(?:\u8f66\u578b|\u9002\u7528|\u89c4\u683c|\u989c\u8272)/.test(extractedValue22) && parseDimensions(value21);
        });
        if (!local30) {
          return;
        }
        const extractedValue23 = parseDimensions(local30.value);
        if (extractedValue23) {
          arg42.length_mm ??= extractedValue23.length_mm;
          arg42.width_mm ??= extractedValue23.width_mm;
          arg42.height_mm ??= extractedValue23.height_mm;
        }
      })(packagingDefaults, packagingSourceRows);
      return {
        defaults: {
          weight_g: packagingDefaults.weight_g,
          length_mm: packagingDefaults.length_mm,
          width_mm: packagingDefaults.width_mm,
          height_mm: packagingDefaults.height_mm
        },
        _hasRealPackaging: packagingDefaults.weight_g != null && packagingDefaults.length_mm != null && packagingDefaults.width_mm != null && packagingDefaults.height_mm != null,
        full_table: packagingRows
      };
    }();
    const productMeasurements = function (arg44) {
      const measurementDefaults = {
        length_mm: null,
        width_mm: null,
        height_mm: null,
        depth_mm: null,
        diameter_mm: null,
        thickness_mm: null,
        weight_g: null
      };
      arg44.forEach(({
        name: value24,
        value: value25
      }) => {
        const local31 = normalizeCompactText(value24).toLowerCase();
        const local32 = String(value25 || "").trim();
        if (!local31 || !local32 || function (arg45) {
          return /(?:\u5305\u88c5|\u5916\u7bb1|\u88c5\u7bb1|package)/i.test(String(arg45 || ""));
        }(local31) || function (arg46) {
          return /(?:\u9002\u7528|\u8f66\u578b|\u8f66\u6b3e|\u5e74\u4efd|\u989c\u8272|\u6750\u8d28)/i.test(String(arg46 || ""));
        }(local31)) {
          return;
        }
        const extractedValue26 = parseDimensions(local32);
        if (extractedValue26 && /(?:\u5c3a\u5bf8|\u89c4\u683c|\u5916\u5f62|\u5916\u89c2|size|dimension)/i.test(local31)) {
          measurementDefaults.length_mm ??= extractedValue26.length_mm;
          measurementDefaults.width_mm ??= extractedValue26.width_mm;
          measurementDefaults.height_mm ??= extractedValue26.height_mm;
        }
        const extractedValue27 = parseFirstNumber(local32);
        if (extractedValue27 != null) {
          if (!/(?:\u5546\u54c1\u91cd|\u4ea7\u54c1\u91cd|\u51c0\u91cd|netweight|weight)/i.test(local31) || /(?:\u5305\u88c5|\u8f7d\u91cd|\u627f\u91cd|\u8d1f\u91cd|load)/i.test(local31)) {
            if (/(?:\u957f\u5ea6|^\u957f(?:\(|\uff08|$)|length)/i.test(local31)) {
              measurementDefaults.length_mm ??= dimensionToMillimeters(local32, extractedValue27);
            } else if (/(?:\u5bbd\u5ea6|^\u5bbd(?:\(|\uff08|$)|width)/i.test(local31)) {
              measurementDefaults.width_mm ??= dimensionToMillimeters(local32, extractedValue27);
            } else if (/(?:\u9ad8\u5ea6|^\u9ad8(?:\(|\uff08|$)|height)/i.test(local31)) {
              measurementDefaults.height_mm ??= dimensionToMillimeters(local32, extractedValue27);
            } else if (/(?:\u6df1\u5ea6|^\u6df1(?:\(|\uff08|$)|depth)/i.test(local31)) {
              measurementDefaults.depth_mm ??= dimensionToMillimeters(local32, extractedValue27);
            } else if (/(?:\u76f4\u5f84|diameter)/i.test(local31)) {
              measurementDefaults.diameter_mm ??= dimensionToMillimeters(local32, extractedValue27);
            } else if (/(?:\u539a\u5ea6|\u539a|thickness)/i.test(local31)) {
              measurementDefaults.thickness_mm ??= dimensionToMillimeters(local32, extractedValue27);
            }
          } else {
            measurementDefaults.weight_g ??= weightToGrams(local32, extractedValue27);
          }
        }
      });
      measurementDefaults.depth_mm ??= measurementDefaults.length_mm;
      return measurementDefaults;
    }(featureRows);
    const specialSpecs = function (arg47, arg48) {
      const local33 = [arg48, ...arg47.flatMap(arg49 => [arg49.name, arg49.value])].join(" | ");
      const tireSpecDefaults = {
        sectionWidthMm: null,
        aspectRatio: null,
        rimDiameterInch: null,
        loadIndex: "",
        speedRating: "",
        season: ""
      };
      const local34 = local33.match(/\b(\d{3})\s*\/\s*(\d{2,3})\s*[Rr]\s*(\d{2})\b/);
      if (local34) {
        tireSpecDefaults.sectionWidthMm = Number(local34[1]);
        tireSpecDefaults.aspectRatio = Number(local34[2]);
        tireSpecDefaults.rimDiameterInch = Number(local34[3]);
      }
      arg47.forEach(({
        name: value28,
        value: value29
      }) => {
        const local35 = normalizeCompactText(value28).toLowerCase();
        const local36 = String(value29 || "").trim();
        if (local35 && local36) {
          if (!tireSpecDefaults.loadIndex && /(?:\u8f7d\u91cd|\u8d1f\u8377|load)/i.test(local35)) {
            const local37 = local36.match(/\d{2,3}(?:\/\d{2,3})?/);
            if (local37) {
              tireSpecDefaults.loadIndex = local37[0];
            }
          }
          if (!tireSpecDefaults.speedRating && /(?:\u901f\u5ea6|speed)/i.test(local35)) {
            const local38 = local36.match(/[A-Z]{1,2}$/i) || local36.match(/\b[A-Z]{1,2}\b/i);
            if (local38) {
              tireSpecDefaults.speedRating = local38[0].toUpperCase();
            }
          }
          if (!tireSpecDefaults.season && /(?:\u5b63\u8282|season)/i.test(local35)) {
            tireSpecDefaults.season = local36;
          }
        }
      });
      const local39 = local33.match(/\b(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z])\b/);
      if (local39) {
        tireSpecDefaults.loadIndex ||= local39[1];
        tireSpecDefaults.speedRating ||= local39[2].toUpperCase();
      }
      if (!tireSpecDefaults.season) {
        if (/\u51ac\u5b63|\u96ea\u5730|winter/i.test(local33)) {
          tireSpecDefaults.season = "冬季";
        } else if (/\u590f\u5b63|summer/i.test(local33)) {
          tireSpecDefaults.season = "夏季";
        } else if (/\u56db\u5b63|allseason|all-season/i.test(local33)) {
          tireSpecDefaults.season = "四季";
        }
      }
      return {
        tire: tireSpecDefaults
      };
    }(featureRows, productName);
    const skuRows = function () {
      const skuRowsFromData = function () {
        const extractedValue30 = collectSkuModel();
        if (extractedValue30) {
          return buildSkuRowsFromSkuModel(extractedValue30, 0, "sku_1688_data");
        } else {
          return [];
        }
      }();
      if (skuRowsFromData.length > 0) {
        return keepInStockSkuRows(skuRowsFromData);
      }
      if (document.querySelector("#skuSelection .gyp-pro-table, #skuSelection .ant-table-wrapper")) {
        const industrySkuRows = function () {
          const industrySkuModel = function () {
            const extractedValue31 = collectSkuModel();
            if (extractedValue31) {
              return extractedValue31;
            }
            for (const local40 of document.querySelectorAll("script:not([src])")) {
              const local41 = local40.textContent;
              if (!local41.includes("\"skuModel\"") || !local41.includes("\"skuInfoMap\"")) {
                continue;
              }
              const local42 = local41.indexOf("\"skuModel\":{");
              if (local42 === -1) {
                continue;
              }
              const local43 = local42 + 11;
              let loopCounter02 = 0;
              let scanValue43 = local43;
              for (let scanValue432 = local43; scanValue432 < local41.length; scanValue432++) {
                if (local41[scanValue432] === "{") {
                  loopCounter02++;
                } else if (local41[scanValue432] === "}" && (loopCounter02--, loopCounter02 === 0)) {
                  scanValue43 = scanValue432 + 1;
                  break;
                }
              }
              try {
                return JSON.parse(local41.slice(local43, scanValue43));
              } catch {
                return null;
              }
            }
            return null;
          }();
          if (industrySkuModel?.skuProps?.length && industrySkuModel?.skuInfoMap) {
            const industrySkuModelRows = function (arg50) {
              return buildSkuRowsFromSkuModel(arg50, 0, "sku_industrypro");
            }(industrySkuModel);
            if (industrySkuModelRows.length > 0) {
              return industrySkuModelRows;
            }
          }
          return function () {
            const arrayList12 = [...document.querySelectorAll("#skuSelection .ant-table-body tr[data-row-key]")];
            if (arrayList12.length) {
              return arrayList12.map((arg51, arg52) => {
                const arrayList13 = [...arg51.querySelectorAll("td.ant-table-cell")];
                const local44 = arrayList13[0]?.querySelector(".gyp-pro-table-title");
                const local45 = local44?.querySelector("img")?.src?.replace(/_sum\.jpg$/, "") || null;
                const local46 = (local44?.querySelector("p")?.textContent || "").trim() || "SKU " + (arg52 + 1);
                const local47 = arrayList13.find(arg53 => arg53.querySelector(".gyp-pro-table-price"))?.querySelector(".gyp-pro-table-price");
                const local48 = local47 ? [...local47.querySelectorAll("span")] : [];
                const local49 = (local48[0]?.textContent || "0").replace(/[^\d.]/g, "");
                const local50 = (local48[1]?.textContent || "").replace(/[^\d]/g, "");
                const objectValue5 = {
                  color_name_cn: local46,
                  size_name_cn: ""
                };
                const objectValue6 = {
                  amount: local49 || "0",
                  currency: "CNY"
                };
                return {
                  row_id: arg52 + 1,
                  sku_unique_id: "sku_industrypro_dom_" + Date.now() + "_" + (arg52 + 1),
                  specs: objectValue5,
                  price: objectValue6,
                  stock_quantity: parseStockQuantity(local50),
                  sku_image_url: local45
                };
              });
            } else {
              return [];
            }
          }();
        }();
        if (industrySkuRows.length > 0) {
          return keepInStockSkuRows(industrySkuRows);
        }
      }
      if (document.querySelector(".pc-sku-wrapper")) {
        const pcSkuRows = function () {
          const arrayList14 = [];
          const local51 = document.querySelector(".pc-sku-wrapper");
          if (!local51) {
            return arrayList14;
          }
          const helperResult16 = function (arg54) {
            const arrayList15 = [];
            arg54.querySelectorAll(".sku-prop-module .prop-item-inner-wrapper").forEach((arg55, arg56) => {
              const local52 = arg55.querySelector(".prop-name")?.getAttribute("title") || readChildText(arg55, ".prop-name") || "Color " + (arg56 + 1);
              const local53 = normalizeImageUrl(arg55.querySelector(".prop-img")?.style?.backgroundImage) || normalizeImageUrl(arg55.querySelector(".prop-img img")?.src || "") || null;
              if (local52) {
                arrayList15.push({
                  name: local52,
                  image: local53
                });
              }
            });
            return function (arg57) {
              const local54 = new Set();
              return arg57.filter(arg58 => {
                const helperResult17 = (arg59 => arg59.name + "||" + (arg59.image || ""))(arg58);
                return !!helperResult17 && !local54.has(helperResult17) && !(local54.add(helperResult17), 0);
              });
            }(arrayList15);
          }(local51);
          const local55 = [...local51.querySelectorAll(".sku-item-wrapper")].map((arg60, arg61) => ({
            sizeName: readChildText(arg60, ".sku-item-name") || "SKU " + (arg61 + 1),
            priceText: readChildText(arg60, ".discountPrice-price") || "0",
            stockText: readChildText(arg60, ".sku-item-sale-num") || ""
          })).filter(arg62 => arg62.sizeName);
          const local56 = helperResult16.length > 0 ? helperResult16 : [{
            name: "默认",
            image: null
          }];
          const local57 = local55.length > 0 ? local55 : [{
            sizeName: "",
            priceText: readFallbackPrice(),
            stockText: ""
          }];
          let rowCounter = 1;
          local56.forEach((arg63, arg64) => {
            local57.forEach((arg65, arg66) => {
              const objectValue8 = {
                color_name_cn: arg63.name || "默认",
                size_name_cn: arg65.sizeName || ""
              };
              arrayList14.push({
                row_id: rowCounter,
                sku_unique_id: "sku_pc_" + Date.now() + "_" + (arg64 + 1) + "_" + (arg66 + 1),
                specs: objectValue8,
                price: {
                  amount: String(arg65.priceText || "0").replace(/[^\d.]/g, "") || "0",
                  currency: "CNY"
                },
                stock_quantity: parseStockQuantity(arg65.stockText),
                sku_image_url: arg63.image || null
              });
              rowCounter += 1;
            });
          });
          return arrayList14;
        }();
        if (pcSkuRows.length > 0) {
          return keepInStockSkuRows(pcSkuRows);
        }
      }
      if (document.querySelector(".next-table-body")) {
        const tableSkuRows = function () {
          const objectValue9 = {
            specs: [],
            price: -1,
            stock: -1
          };
          const arrayList16 = [];
          const local58 = document.querySelector(".selector-table") || document.body;
          const stateObject9 = objectValue9;
          local58.querySelectorAll(".next-table-header-node").forEach(arg67 => {
            const local59 = arg67.querySelector(".next-table-cell-wrapper");
            const numericValue = Number(local59?.getAttribute("data-next-table-col"));
            if (Number.isNaN(numericValue)) {
              return;
            }
            const extractedValue32 = normalizeCompactText(arg67.innerText || "");
            if (/\u4ef7|\u5143|price/i.test(extractedValue32)) {
              stateObject9.price = numericValue;
            } else if (/\u5e93\u5b58|stock/i.test(extractedValue32)) {
              stateObject9.stock = numericValue;
            } else if (!/\u6570\u91cf|\u8fdb\u8d27|\u8ba2\u8d2d|\u5e8f\u5217/.test(extractedValue32)) {
              stateObject9.specs.push({
                index: numericValue,
                name: extractedValue32
              });
            }
          });
          const objectValue10 = {};
          local58.querySelectorAll(".next-table-body td.next-table-cell").forEach(arg68 => {
            const numericValue2 = Number(arg68.getAttribute("data-next-table-row") || arg68.querySelector("div[data-next-table-row]")?.getAttribute("data-next-table-row"));
            const numericValue3 = Number(arg68.getAttribute("data-next-table-col") || arg68.querySelector("div[data-next-table-col]")?.getAttribute("data-next-table-col"));
            if (Number.isNaN(numericValue2) || Number.isNaN(numericValue3)) {
              return;
            }
            objectValue10[numericValue2] ||= {};
            const local60 = arg68.querySelector(".normal-text") || arg68.querySelector(".label-content") || arg68;
            const local61 = (local60.getAttribute("title") || local60.innerText || "").trim();
            const local62 = arg68.querySelector(".single-sku-img-pop") || arg68.querySelector(".od-gyp-pc-sku-selection-sku");
            const extractedValue33 = normalizeImageUrl(local62?.style?.backgroundImage || local62?.querySelector("img")?.src || "");
            const objectValue11 = {
              txt: local61,
              img: extractedValue33
            };
            objectValue10[numericValue2][numericValue3] = objectValue11;
          });
          Object.keys(objectValue10).map(Number).sort((arg69, arg70) => arg69 - arg70).forEach((arg71, arg72) => {
            const local63 = objectValue10[arg71];
            let labelString = "";
            let local64 = null;
            const arrayList17 = [];
            stateObject9.specs.forEach(arg73 => {
              const local65 = local63[arg73.index];
              if (local65) {
                if (local65.img) {
                  labelString = local65.txt || labelString;
                  local64 = local65.img || local64;
                  return;
                } else {
                  if (local65.txt && local65.txt !== "-" && local65.txt !== "0") {
                    arrayList17.push(local65.txt);
                  }
                  return;
                }
              }
            });
            labelString ||= local63[stateObject9.specs[0]?.index]?.txt || "默认";
            local64 ||= null;
            arrayList16.push({
              row_id: arg72 + 1,
              sku_unique_id: "sku_table_" + Date.now() + "_" + (arg72 + 1),
              specs: {
                color_name_cn: labelString,
                size_name_cn: arrayList17.length > 0 ? arrayList17.join(" ") : ""
              },
              price: {
                amount: stateObject9.price >= 0 && local63[stateObject9.price] && local63[stateObject9.price].txt.replace(/[^\d.]/g, "") || "0",
                currency: "CNY"
              },
              stock_quantity: stateObject9.stock >= 0 && local63[stateObject9.stock] ? parseStockQuantity(local63[stateObject9.stock].txt) : null,
              sku_image_url: local64
            });
          });
          return arrayList16;
        }();
        if (tableSkuRows.length > 0) {
          return keepInStockSkuRows(tableSkuRows);
        }
      }
      const standardSkuRows = function () {
        const arrayList18 = [];
        document.querySelectorAll("#skuSelection .feature-item").forEach(arg74 => {
          const local66 = readChildText(arg74, ".feature-item-label") || readChildText(arg74, ".spec-title") || "规格";
          const arrayList19 = [];
          arg74.querySelectorAll(".transverse-filter .sku-filter-button").forEach(arg75 => {
            const extractedValue34 = readChildText(arg75, ".label-name");
            const extractedValue35 = normalizeImageUrl(arg75.querySelector("img")?.src || "");
            if (extractedValue34) {
              arrayList19.push({
                name: extractedValue34,
                image: extractedValue35,
                price: null,
                stock: null
              });
            }
          });
          arg74.querySelectorAll(".expand-view-list .expand-view-item").forEach(arg76 => {
            const local67 = arg76.querySelector(".item-label")?.getAttribute("title") || readChildText(arg76, ".item-label");
            const extractedValue36 = normalizeImageUrl(arg76.querySelector("img")?.src || "");
            const local68 = readChildText(arg76, ".item-price-stock").replace(/[^\d.]/g, "");
            const local69 = arg76.querySelector("od-text[i18n=\"sku-stock\"]")?.getAttribute("data");
            let defaultStockQuantity = null;
            if (local69) {
              try {
                defaultStockQuantity = parseStockQuantity(JSON.parse(local69)?.[0]);
              } catch {
                defaultStockQuantity = null;
              }
            }
            if (local67) {
              arrayList19.push({
                name: local67,
                image: extractedValue36,
                price: local68 || null,
                stock: defaultStockQuantity
              });
            }
          });
          if (arrayList19.length > 0) {
            arrayList18.push({
              label: local66,
              options: arrayList19
            });
          }
        });
        if (arrayList18.length === 0) {
          return [{
            row_id: 1,
            sku_unique_id: "sku_standard_" + Date.now() + "_1",
            specs: {
              color_name_cn: "默认",
              size_name_cn: ""
            },
            price: {
              amount: readFallbackPrice(),
              currency: "CNY"
            },
            stock_quantity: null,
            sku_image_url: null
          }];
        }
        if (arrayList18.length === 1) {
          return arrayList18[0].options.map((arg77, arg78) => ({
            row_id: arg78 + 1,
            sku_unique_id: "sku_group_" + Date.now() + "_" + (arg78 + 1),
            specs: {
              color_name_cn: arg77.name,
              size_name_cn: ""
            },
            price: {
              amount: arg77.price || "0",
              currency: "CNY"
            },
            stock_quantity: parseStockQuantity(arg77.stock),
            sku_image_url: arg77.image || null
          }));
        }
        const local70 = Math.max(arrayList18.findIndex(arg79 => arg79.options.some(arg80 => arg80.image)), 0);
        const local71 = arrayList18[local70];
        const extractedValue37 = cartesianSkuOptions(arrayList18.filter((arg81, arg82) => arg82 !== local70));
        return local71.options.flatMap((arg83, arg84) => extractedValue37.map((arg85, arg86) => ({
          row_id: arg84 * extractedValue37.length + arg86 + 1,
          sku_unique_id: "sku_combo_" + Date.now() + "_" + (arg84 + 1) + "_" + (arg86 + 1),
          specs: {
            color_name_cn: arg83.name || "默认",
            size_name_cn: arg85.name || ""
          },
          price: {
            amount: arg85.price || arg83.price || "0",
            currency: "CNY"
          },
          stock_quantity: parseStockQuantity(arg85.stock ?? arg83.stock),
          sku_image_url: arg83.image || arg85.image || null
        })));
      }();
      if (standardSkuRows.length > 0) {
        return keepInStockSkuRows(standardSkuRows);
      } else {
        return [{
          row_id: 1,
          sku_unique_id: "sku_1688_" + Date.now() + "_1",
          specs: {
            color_name_cn: "默认",
            size_name_cn: ""
          },
          price: {
            amount: readFallbackPrice(),
            currency: "CNY"
          },
          stock_quantity: null,
          sku_image_url: null
        }];
      }
    }();
    (function (arg87, arg88) {
      if (!arg87 || !arg87.length || !arg88 || !arg88.length) {
        return;
      }
      const arrayList20 = [];
      let local72 = null;
      arg88.forEach(({
        label: value38,
        value: value39
      }) => {
        if (!function (arg89, arg90) {
          const extractedValue40 = normalizeCompactText(String(arg89 || ""));
          const local73 = String(arg90 || "").trim();
          return !!/重量|毛重|净重|weight|长度?|宽度?|高度?|length|width|height|体积|volume/i.test(extractedValue40) || !!/^\d+(\.\d+)?$/.test(local73);
        }(value38, value39)) {
          local72 = {
            specValue: String(value39 || ""),
            measurements: []
          };
          arrayList20.push(local72);
        } else if (local72) {
          local72.measurements.push({
            label: value38,
            value: value39
          });
        }
      });
      if (arrayList20.length && !arrayList20.every(arg91 => !arg91.measurements.length)) {
        arg87.forEach(arg92 => {
          const local74 = [String(arg92.specs?.color_name_cn || "").trim(), String(arg92.specs?.size_name_cn || "").trim()].filter(arg93 => arg93 && arg93 !== "默认" && arg93 !== "均码");
          if (!local74.length) {
            return;
          }
          let local75 = null;
          let loopCounter03 = 0;
          arrayList20.forEach(arg94 => {
            const local76 = String(arg94.specValue || "").toLowerCase();
            let loopCounter04 = 0;
            local74.forEach(arg95 => {
              if (arg95 && local76.includes(arg95.toLowerCase())) {
                loopCounter04++;
              }
            });
            if (loopCounter04 > loopCounter03) {
              loopCounter03 = loopCounter04;
              local75 = arg94;
            }
          });
          if (!local75 || loopCounter03 === 0) {
            return;
          }
          const stateObject14 = {
            weight_g: null,
            length_mm: null,
            width_mm: null,
            height_mm: null
          };
          local75.measurements.forEach(({
            label: value41,
            value: value42
          }) => {
            applyPackagingMeasurement(stateObject14, value41, value42);
          });
          if (stateObject14.weight_g != null || stateObject14.length_mm != null || stateObject14.width_mm != null || stateObject14.height_mm != null) {
            arg92.packaging = stateObject14;
          }
        });
      }
    })(skuRows, packagingInfo.full_table);

    // ================================================================
    // contextPath override (2026-11)
    // ----------------------------------------------------------------
    // 1688 detail pages keep real data in window.context (~55KB).
    // DOM scraping yields only 10 attributes; contextPath yields 27.
    // The 17 missing ones include Material / Brand / Craft / Category /
    // Size -- exactly what Ozon attribute mapping needs.
    //
    // adapter runs in ISOLATED world and cannot read window.context
    // directly, so it asks page-bridge (in MAIN world) via GET_PAGE_STATE
    // and reads payload.contextPathProduct.
    // ================================================================
    let cpProduct = null;
    try {
      adapterDiag('before-requestContextPath');
      cpProduct = await (function requestContextPath() {
        const REQ = 'spb-self-hosted:content';
        const RES = 'spb-self-hosted:bridge';
        const requestId = 'ctx-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        return new Promise((resolve) => {
          const timer = setTimeout(function () { cleanup(); resolve(null); }, 8000);
          function onMessage(ev) {
            if (ev.source !== window) return;
            const d = ev.data;
            if (!d || d.direction !== RES || d.requestId !== requestId) return;
            cleanup();
            resolve(d.ok && d.payload ? (d.payload.contextPathProduct || null) : null);
          }
          function cleanup() { clearTimeout(timer); window.removeEventListener('message', onMessage); }
          window.addEventListener('message', onMessage);
          try {
            window.postMessage({ direction: REQ, requestId, type: 'GET_PAGE_STATE' }, '*');
          } catch (_e) { cleanup(); resolve(null); }
        });
      })();
    } catch (_e) { cpProduct = null; }
    adapterDiag('after-requestContextPath has=' + !!cpProduct);

    if (cpProduct) {
      if (cpProduct.title) productName = cpProduct.title;
      if (cpProduct.shopName) cpShopName = cpProduct.shopName;
      if (Array.isArray(cpProduct.mainImages) && cpProduct.mainImages.length) {
        mainImages = cpProduct.mainImages.slice(0, 40);
      }
      if (Array.isArray(cpProduct.attributes) && cpProduct.attributes.length) {
        featureRows = cpProduct.attributes
          .filter(function (a) { return a && a.name && a.value; })
          .map(function (a) { return { name: String(a.name).trim(), value: String(a.value).trim() }; });
      }
      if (cpProduct.leafCategoryName) cpLeafCategory = cpProduct.leafCategoryName;
    }


    return {
      meta_info: {
        source_url: window.location.href,
        crawl_timestamp: Date.now(),
        sku_source_type: skuSourceType,
        source_category_path: sourceCategoryPath,
        source_category: (local77 = sourceCategoryPath, String(local77 || "").split(" > ").filter(Boolean).pop() || ""),
        source_category_id: findCategoryIdFromWindowData() || findCategoryIdFromScripts() || 0,
        ...(cpProduct ? { context_path_used: true } : {})
      },
      global_data: {
        product_name: productName,
        shop_name: cpShopName,
        description_clean_text: descriptionText,
        category_hint: sourceCategoryPath || cpLeafCategory || '',
        leaf_category_name: cpLeafCategory,
        features: featureRows,
        packaging: packagingInfo,
        product_measurements: productMeasurements,
        special_specs: specialSpecs,
        media_gallery: {
          main_images: mainImages,
          detail_images: detailImages,
          video_urls: videoUrls
        }
      },
      sku_matrix: skuRows
    };
    var local77;
  }
  function findBreadcrumbPathInJsonLd(arg96, arg97, arg98 = 0) {
    if (!arg96 || arg98 > 6) {
      return "";
    }
    if (Array.isArray(arg96)) {
      for (const local78 of arg96) {
        const helperResult22 = findBreadcrumbPathInJsonLd(local78, arg97, arg98 + 1);
        if (isValidCategoryPath(helperResult22)) {
          return helperResult22;
        }
      }
      return "";
    }
    if (typeof arg96 != "object") {
      return "";
    }
    const local79 = arg96["@type"];
    const local80 = Array.isArray(local79) ? local79.join(" ") : String(local79 || "");
    if (/BreadcrumbList/i.test(local80) && Array.isArray(arg96.itemListElement)) {
      return normalizeBreadcrumbValue(arg96.itemListElement, arg97);
    }
    for (const local81 of Object.values(arg96)) {
      const helperResult23 = findBreadcrumbPathInJsonLd(local81, arg97, arg98 + 1);
      if (isValidCategoryPath(helperResult23)) {
        return helperResult23;
      }
    }
    return "";
  }
  function findCategoryPathInData(arg99, arg100, arg101) {
    if (!arg99 || arg101 > 7) {
      return "";
    }
    if (Array.isArray(arg99)) {
      const extractedValue43 = normalizeBreadcrumbValue(arg99, arg100);
      if (isValidCategoryPath(extractedValue43)) {
        return extractedValue43;
      }
      for (const local82 of arg99.slice(0, 80)) {
        const helperResult32 = findCategoryPathInData(local82, arg100, arg101 + 1);
        if (isValidCategoryPath(helperResult32)) {
          return helperResult32;
        }
      }
      return "";
    }
    if (typeof arg99 != "object") {
      return "";
    }
    const arrayList21 = ["categoryPath", "category_path", "categoryNamePath", "catPath", "breadcrumb", "breadCrumb", "breadcrumbs", "crumbs"];
    for (const local83 of arrayList21) {
      const extractedValue44 = normalizeBreadcrumbValue(arg99[local83], arg100);
      if (isValidCategoryPath(extractedValue44)) {
        return extractedValue44;
      }
    }
    const extractedValue45 = normalizeBreadcrumbValue(arg99.leafCategoryName || arg99.leaf_category_name || arg99.categoryName || arg99.catName || arg99.category || arg99.category_name, arg100);
    if (isValidCategoryPath(extractedValue45)) {
      return extractedValue45;
    }
    for (const local84 of Object.values(arg99).slice(0, 120)) {
      const helperResult33 = findCategoryPathInData(local84, arg100, arg101 + 1);
      if (isValidCategoryPath(helperResult33)) {
        return helperResult33;
      }
    }
    return "";
  }
  function normalizeBreadcrumbValue(arg102, arg103) {
    if (Array.isArray(arg102)) {
      return normalizeCategoryPath(arg102.map(arg104 => arg104 == null ? "" : typeof arg104 == "string" || typeof arg104 == "number" ? arg104 : arg104.name || arg104.title || arg104.text || arg104.label || arg104.leafCategoryName || arg104.categoryName || arg104.catName || arg104.item?.name || "").filter(Boolean).join(" > "), arg103);
    } else {
      return normalizeCategoryPath(arg102 && typeof arg102 == "object" ? arg102.name || arg102.title || arg102.text || arg102.label || arg102.leafCategoryName || arg102.categoryName || arg102.catName || arg102.item?.name || "" : arg102, arg103);
    }
  }
  function extractStringFieldFromScript(arg105, arg106) {
    const local85 = String(arg106 || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const local86 = "(?:\"" + local85 + "\"|'" + local85 + "'|" + local85 + ")";
    const local87 = String(arg105 || "").match(new RegExp(local86 + "\\s*:\\s*[\"']([^\"']{2,180})[\"']", "i"));
    const local88 = local87?.[1] || "";
    if (!local88) {
      return "";
    }
    try {
      return JSON.parse("\"" + local88.replace(/"/g, "\\\"") + "\"");
    } catch {
      return local88;
    }
  }
  function findCategoryIdFromWindowData() {
    const arrayList22 = [window.__INIT_DATA__, window.__INITIAL_DATA__, window.detailData, window.__GLOBAL_DATA__, window.__offerDetailData];
    for (const local89 of arrayList22) {
      try {
        const extractedValue46 = findCategoryIdInData(typeof local89 == "string" ? JSON.parse(local89) : local89, 0);
        if (extractedValue46) {
          return extractedValue46;
        }
      } catch {}
    }
    return 0;
  }
  function findCategoryIdFromScripts() {
    const arrayList23 = ["leafCategoryId", "leaf_category_id", "catId", "categoryId", "category_id"];
    for (const local90 of document.querySelectorAll("script:not([src])")) {
      const local91 = local90.textContent || "";
      if (/leafCategoryId|leaf_category_id|catId|categoryId|category_id/.test(local91)) {
        for (const local92 of arrayList23) {
          const extractedValue47 = extractNumericFieldFromScript(local91, local92);
          if (extractedValue47) {
            return extractedValue47;
          }
        }
      }
    }
    return 0;
  }
  function findCategoryIdInData(arg107, arg108) {
    if (!arg107 || arg108 > 7) {
      return 0;
    }
    if (Array.isArray(arg107)) {
      for (const local93 of arg107.slice(0, 80)) {
        const helperResult82 = findCategoryIdInData(local93, arg108 + 1);
        if (helperResult82) {
          return helperResult82;
        }
      }
      return 0;
    }
    if (typeof arg107 != "object") {
      return 0;
    }
    const numericValue4 = Number(arg107.leafCategoryId || arg107.leaf_category_id || arg107.catId || arg107.categoryId || arg107.category_id || 0);
    if (numericValue4 > 0) {
      return numericValue4;
    }
    for (const local94 of Object.values(arg107).slice(0, 120)) {
      const helperResult83 = findCategoryIdInData(local94, arg108 + 1);
      if (helperResult83) {
        return helperResult83;
      }
    }
    return 0;
  }
  function extractNumericFieldFromScript(arg109, arg110) {
    const local95 = String(arg110 || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const local96 = "(?:\"" + local95 + "\"|'" + local95 + "'|" + local95 + ")";
    const local97 = String(arg109 || "").match(new RegExp(local96 + "\\s*:\\s*(\\d{2,})", "i"));
    return Number(local97?.[1] || 0) || 0;
  }
  function normalizeCategoryPath(arg111, arg112 = "") {
    const extractedValue48 = normalizeCategorySegment(arg112);
    const local98 = new Set(["首页", "主页", "1688", "阿里巴巴", "阿里巴巴1688", "采购批发", "所有类目", "全部类目", "全部分类", "当前位置", "您所在的位置", "商品详情"]);
    const local99 = String(arg111 || "").replace(/&gt;|&rsaquo;|&raquo;/gi, ">").replace(/\u00a0/g, " ").replace(/当前位置[:：]?|您所在的位置[:：]?|所在位置[:：]?/g, ">").split(/(?:>|›|»|\/|\\|\n|\r|\t|\s+-\s+|\s+—\s+|\s+·\s+)/).map(normalizeCategorySegment).filter(Boolean).filter(arg113 => !local98.has(arg113)).filter(arg114 => arg114 !== extractedValue48).filter(arg115 => arg115.length <= 40).filter(arg116 => !/店铺|供应商|公司|客服|收藏|分享/.test(arg116));
    const arrayList24 = [];
    for (const local100 of local99) {
      if (arrayList24[arrayList24.length - 1] !== local100) {
        arrayList24.push(local100);
      }
    }
    return arrayList24.join(" > ");
  }
  function normalizeCategorySegment(arg117) {
    return String(arg117 || "").replace(/\s+/g, " ").replace(/^[>›»/\-—·\s]+|[>›»/\-—·\s]+$/g, "").trim();
  }
  function isValidCategoryPath(arg118) {
    const local101 = String(arg118 || "").split(" > ").filter(Boolean);
    return local101.length > 0 && local101.some(arg119 => /[\u4e00-\u9fffA-Za-z]{2,}/.test(arg119));
  }
  function readFallbackPrice() {
    const arrayList25 = [".price-text", ".price-origin-text", ".od-pc-offer-price-text", ".od-pc-offer-price-content", "#mod-detail-price .price", ".price-unit-price", ".od-pc-price-original .price-text", ".price-length-5", ".price-length-4", ".price-length-3", ".price-length-2", ".step-price-wrapper .discountPrice-price", ".discountPrice-price", ".sku-item-price", ".offer-price .price-text"];
    for (const local102 of arrayList25) {
      const local103 = document.querySelector(local102);
      if (local103) {
        const local104 = (local103.innerText || "").replace(/[^\d.]/g, "");
        if (local104 && Number(local104) > 0) {
          return local104;
        }
      }
    }
    const extractedValue49 = findPriceInShadowRoots(document.body, arrayList25);
    if (extractedValue49) {
      return extractedValue49;
    }
    const extractedValue50 = findPriceInPriceElements(document.body);
    if (extractedValue50) {
      return extractedValue50;
    }
    return function () {
      try {
        const local105 = document.querySelectorAll("script[type=\"application/ld+json\"]");
        for (const local106 of local105) {
          const local107 = JSON.parse(local106.textContent || "{}");
          const local108 = local107?.offers?.price || local107?.offers?.lowPrice;
          if (local108 && Number(local108) > 0) {
            return String(local108);
          }
        }
      } catch {}
      try {
        const local109 = window.__INIT_DATA__ || window.__INITIAL_DATA__ || window.detailData;
        if (local109) {
          const local110 = typeof local109 == "string" ? JSON.parse(local109) : local109;
          const local111 = local110?.data?.offerPrice?.price || local110?.data?.price || local110?.globalData?.offerPrice?.price || local110?.globalData?.saleInfo?.price || local110?.data?.tradePrice?.price;
          if (local111 && Number(local111) > 0) {
            return String(local111).replace(/[^\d.]/g, "");
          }
        }
      } catch {}
      return null;
    }() || "0";
  }
  function findPriceInShadowRoots(arg120, arg121) {
    const local112 = document.createTreeWalker(arg120, NodeFilter.SHOW_ELEMENT);
    while (local112.nextNode()) {
      const local113 = local112.currentNode;
      if (local113.shadowRoot) {
        for (const local114 of arg121) {
          const local115 = local113.shadowRoot.querySelector(local114);
          if (local115) {
            const local116 = (local115.innerText || "").replace(/[^\d.]/g, "");
            if (local116 && Number(local116) > 0) {
              return local116;
            }
          }
        }
        const helperResult142 = findPriceInShadowRoots(local113.shadowRoot, arg121);
        if (helperResult142) {
          return helperResult142;
        }
      }
    }
    return null;
  }
  function findPriceInPriceElements(arg122) {
    const local117 = arg122.querySelectorAll("[class*=\"price\"], [class*=\"Price\"], [class*=\"offer-price\"], [class*=\"discountPrice\"], [id*=\"price\"], [id*=\"Price\"]");
    for (const local118 of local117) {
      const local119 = (local118.innerText || "").trim().match(/(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)/);
      if (local119 && Number(local119[1]) > 0) {
        return local119[1];
      }
    }
    const local120 = document.createTreeWalker(arg122, NodeFilter.SHOW_ELEMENT);
    while (local120.nextNode()) {
      const local121 = local120.currentNode;
      if (local121.shadowRoot) {
        const helperResult152 = findPriceInPriceElements(local121.shadowRoot);
        if (helperResult152) {
          return helperResult152;
        }
      }
    }
    return null;
  }
  function parseStockQuantity(arg123, arg124 = null) {
    if (arg123 == null) {
      return arg124;
    }
    if (typeof arg123 == "number") {
      if (Number.isFinite(arg123)) {
        return arg123 >= 0 ? Math.floor(arg123) : null;
      } else {
        return arg124;
      }
    }
    const local122 = String(arg123).trim();
    if (/^-/.test(local122)) return null;
    if (!local122) {
      return arg124;
    }
    if (/无货|缺货|售罄|已售罄|无库存|不可售|下架|sold\s*out|out\s*of\s*stock/i.test(local122)) {
      return 0;
    }
    const local123 = local122.replace(/[,，]/g, "").match(/\d+/);
    if (!local123) {
      return arg124;
    }
    const numericValue5 = Number(local123[0]);
    if (Number.isFinite(numericValue5)) {
      return numericValue5;
    } else {
      return arg124;
    }
  }
  function firstPresent(...value51) {
    return value51.find(arg125 => arg125 != null && String(arg125).trim() !== "");
  }
  function keepInStockSkuRows(arg126) {
    return (arg126 || []).map((arg128, arg129) => ({
      ...arg128,
      row_id: arg129 + 1
    }));
  }
  function collectSkuModel() {
    const helperResult20 = function () {
      try {
        for (const local124 of Object.keys(window)) {
          try {
            const local125 = window[local124];
            if (!local125 || typeof local125 != "object" || Array.isArray(local125)) {
              continue;
            }
            const extractedValue52 = findSkuModelInObject(local125, 0);
            if (extractedValue52) {
              return extractedValue52;
            }
          } catch {}
        }
      } catch {}
      return null;
    }();
    if (helperResult20) {
      skuSourceType = 'main_world';
      return helperResult20;
    }
    for (const local126 of document.querySelectorAll("script:not([src])")) {
      const local127 = local126.textContent || "";
      if (!local127.includes("skuInfoMap") || !local127.includes("skuProps")) {
        continue;
      }
      const extractedValue53 = parseSkuModelFromScript(local127);
      if (extractedValue53) {
        skuSourceType = 'script';
        return extractedValue53;
      }
    }
    return null;
  }
  function findSkuModelInObject(arg130, arg131) {
    if (!arg130 || typeof arg130 != "object" || arg131 > 8) {
      return null;
    }
    if (arg130.skuInfoMap && Array.isArray(arg130.skuProps)) {
      return arg130;
    }
    if (arg130.skuModel?.skuInfoMap && Array.isArray(arg130.skuModel?.skuProps)) {
      return arg130.skuModel;
    }
    for (const local128 of Object.values(arg130)) {
      const helperResult202 = findSkuModelInObject(local128, arg131 + 1);
      if (helperResult202) {
        return helperResult202;
      }
    }
    return null;
  }
  function parseSkuModelFromScript(arg132) {
    const extractedValue54 = extractJsonValueByKey(arg132, "skuModel");
    if (extractedValue54?.skuInfoMap && Array.isArray(extractedValue54?.skuProps)) {
      return extractedValue54;
    }
    const extractedValue55 = extractJsonValueByKey(arg132, "skuInfoMap");
    const extractedValue56 = extractJsonValueByKey(arg132, "skuProps");
    if (extractedValue55 && Array.isArray(extractedValue56)) {
      return {
        skuInfoMap: extractedValue55,
        skuInfoMapOriginal: extractJsonValueByKey(arg132, "skuInfoMapOriginal"),
        skuProps: extractedValue56
      };
    } else {
      return null;
    }
  }
  function extractJsonValueByKey(arg133, arg134) {
    const stringValue = String(arg133 || "");
    const arrayList26 = ["\"" + arg134 + "\"", "'" + arg134 + "'", arg134];
    for (const local129 of arrayList26) {
      let loopCounter05 = 0;
      while (loopCounter05 < stringValue.length) {
        const local130 = stringValue.indexOf(local129, loopCounter05);
        if (local130 === -1) {
          break;
        }
        if (/\w/.test(stringValue[local130 - 1] || "")) {
          loopCounter05 = local130 + 1;
          continue;
        }
        let local131 = local130 + local129.length;
        while (local131 < stringValue.length && /\s/.test(stringValue[local131])) {
          local131++;
        }
        if (stringValue[local131] !== ":") {
          loopCounter05 = local130 + 1;
          continue;
        }
        for (local131++; local131 < stringValue.length && /\s/.test(stringValue[local131]);) {
          local131++;
        }
        const local132 = stringValue[local131];
        if (local132 !== "{" && local132 !== "[") {
          loopCounter05 = local130 + 1;
          continue;
        }
        const extractedValue57 = findBalancedJsonEnd(stringValue, local131, local132, local132 === "{" ? "}" : "]");
        if (extractedValue57 < 0) {
          loopCounter05 = local130 + 1;
        } else {
          try {
            return JSON.parse(stringValue.slice(local131, extractedValue57 + 1));
          } catch {}
          loopCounter05 = local130 + 1;
        }
      }
    }
    return null;
  }
  function findBalancedJsonEnd(arg135, arg136, arg137, arg138) {
    let loopCounter06 = 0;
    let labelString2 = "";
    let local133 = false;
    for (let positionIndex136 = arg136; positionIndex136 < arg135.length; positionIndex136 += 1) {
      const local134 = arg135[positionIndex136];
      if (labelString2) {
        if (local133) {
          local133 = false;
        } else if (local134 === "\\") {
          local133 = true;
        } else if (local134 === labelString2) {
          labelString2 = "";
        }
      } else if (local134 !== "\"" && local134 !== "'") {
        if (local134 !== arg137) {
          if (local134 === arg138 && (loopCounter06 -= 1, loopCounter06 === 0)) {
            return positionIndex136;
          }
        } else {
          loopCounter06 += 1;
        }
      } else {
        labelString2 = local134;
      }
    }
    return -1;
  }
  function buildSkuRowsFromSkuModel(arg139, arg140, arg141) {
    const helperResult21 = function (arg142, arg143) {
      const helperResult24 = function (arg144) {
        return (arg144 || []).map(arg145 => {
          const local135 = new Map();
          (arg145?.value || arg145?.values || []).forEach((arg146, arg147) => {
            const extractedValue58 = normalizeSkuKey(arg146?.name || arg146?.value || arg146?.text);
            if (extractedValue58 && !local135.has(extractedValue58)) {
              local135.set(extractedValue58, arg147);
            }
          });
          return local135;
        }).filter(arg148 => arg148.size > 0);
      }(arg143);
      if (helperResult24.length) {
        return arg142.map((arg149, arg150) => ({
          entry: arg149,
          originalIndex: arg150,
          visualOrder: scoreSkuVisualOrder(arg149, helperResult24)
        })).sort((arg151, arg152) => function (arg153, arg154) {
          const local136 = Math.max(arg153.length, arg154.length);
          for (let loopCounter07 = 0; loopCounter07 < local136; loopCounter07 += 1) {
            const local137 = arg153[loopCounter07] ?? Number.MAX_SAFE_INTEGER;
            const local138 = arg154[loopCounter07] ?? Number.MAX_SAFE_INTEGER;
            if (local137 !== local138) {
              return local137 - local138;
            }
          }
          return 0;
        }(arg151.visualOrder, arg152.visualOrder) || arg151.originalIndex - arg152.originalIndex).map(arg155 => arg155.entry);
      } else {
        return arg142;
      }
    }(Object.entries(arg139?.skuInfoMap || arg139?.skuInfoMapOriginal || {}), arg139.skuProps);
    if (!helperResult21.length || !Array.isArray(arg139?.skuProps)) {
      return [];
    }
    const helperResult25 = function (arg156) {
      const local139 = new Map();
      (arg156 || []).forEach(arg157 => {
        (arg157?.value || arg157?.values || []).forEach(arg158 => {
          const extractedValue59 = normalizeSkuKey(arg158?.name || arg158?.value || arg158?.text);
          const extractedValue60 = normalizeImageUrl(arg158?.imageUrl || arg158?.image || arg158?.picUrl || arg158?.img || arg158?.imageURI || arg158?.imageUrlMap?.original || "");
          if (extractedValue59 && extractedValue60 && !local139.has(extractedValue59)) {
            local139.set(extractedValue59, extractedValue60);
          }
        });
      });
      return local139;
    }(arg139.skuProps);
    (function () {
      const local140 = new Map();
      function cacheSkuOptionImage(arg159, arg160) {
        const extractedValue61 = normalizeSkuKey(arg159);
        if (extractedValue61 && arg160 && !local140.has(extractedValue61)) {
          local140.set(extractedValue61, arg160);
        }
      }
      document.querySelectorAll("#skuSelection .sku-filter-button, #skuSelection .expand-view-item").forEach(arg161 => {
        cacheSkuOptionImage(arg161.querySelector(".item-label")?.getAttribute("title") || readChildText(arg161, ".item-label") || readChildText(arg161, ".label-name") || arg161.getAttribute("title") || "", readElementImageUrl(arg161));
      });
      document.querySelectorAll(".pc-sku-wrapper .prop-item-inner-wrapper").forEach(arg162 => {
        cacheSkuOptionImage(arg162.querySelector(".prop-name")?.getAttribute("title") || readChildText(arg162, ".prop-name") || "", readElementImageUrl(arg162));
      });
      document.querySelectorAll("#skuSelection .ant-table-body tr[data-row-key]").forEach(arg163 => {
        const local141 = arg163.querySelector(".gyp-pro-table-title");
        cacheSkuOptionImage((local141?.querySelector("p")?.textContent || "").trim(), readElementImageUrl(local141 || arg163));
      });
      document.querySelectorAll(".next-table-body td.next-table-cell").forEach(arg164 => {
        const local142 = arg164.querySelector(".single-sku-img-pop") || arg164.querySelector(".od-gyp-pc-sku-selection-sku");
        if (!local142) {
          return;
        }
        const local143 = arg164.querySelector(".normal-text") || arg164.querySelector(".label-content") || arg164;
        cacheSkuOptionImage((local143.getAttribute("title") || local143.innerText || "").trim(), readElementImageUrl(local142));
      });
      return local140;
    })().forEach((arg165, arg166) => {
      if (!helperResult25.has(arg166)) {
        helperResult25.set(arg166, arg165);
      }
    });
    const local144 = Math.max(arg139.skuProps.findIndex(arg167 => (arg167?.value || arg167?.values || []).some(arg168 => arg168?.imageUrl || arg168?.image || arg168?.picUrl || helperResult25.has(normalizeSkuKey(arg168?.name || arg168?.value || arg168?.text)))), 0);
    const arrayList27 = [];
    const local145 = new Set();
    helperResult21.forEach(([local146, local147], arg169) => {
      const helperResult26 = function (arg170) {
        const local148 = String(arg170 ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
        if (!local148 || Number(local148[0]) <= 0) {
          return "";
        } else {
          return local148[0];
        }
      }(local147?.discountPrice ?? local147?.price ?? local147?.salePrice ?? local147?.currentPrice);
      const extractedValue62 = splitSkuSpecAttrs(local147?.specAttrs || local146);
      if (!extractedValue62.length) {
        return;
      }
      const local149 = extractedValue62.join(">") + "||" + helperResult26;
      if (local145.has(local149)) {
        return;
      }
      local145.add(local149);
      const local150 = extractedValue62[local144] || extractedValue62[0] || "默认";
      const local151 = extractedValue62.filter((arg171, arg172) => arg172 !== local144).join(" ");
      const local152 = helperResult25.get(normalizeSkuKey(local150)) || extractedValue62.reduce((arg173, arg174) => arg173 || helperResult25.get(normalizeSkuKey(arg174)) || "", "") || null;
      const objectValue15 = {
        color_name_cn: local150,
        size_name_cn: local151
      };
      const objectValue16 = {
        amount: helperResult26 || null,
        currency: "CNY"
      };
      arrayList27.push({
        row_id: arrayList27.length + 1,
        sku_unique_id: String(local147?.skuId || local147?.specId || arg141 + "_" + Date.now() + "_" + (arg169 + 1)),
        specs: objectValue15,
        price: objectValue16,
        stock_quantity: parseStockQuantity(firstPresent(local147?.canBookCount, local147?.stock, local147?.stockQuantity)),
        sku_image_url: local152
      });
    });
    return arrayList27;
  }
  function scoreSkuVisualOrder(arg175, arg176) {
    const [local153, local154] = arg175;
    const local155 = splitSkuSpecAttrs(local154?.specAttrs || local153).map(arg177 => normalizeSkuKey(arg177));
    const local156 = Number.MAX_SAFE_INTEGER;
    return arg176.map((arg178, arg179) => {
      const extractedValue63 = findVisualOrderIndex(local155[arg179], arg178);
      if (extractedValue63 < local156) {
        return extractedValue63;
      }
      for (const local157 of local155) {
        const extractedValue64 = findVisualOrderIndex(local157, arg178);
        if (extractedValue64 < local156) {
          return extractedValue64;
        }
      }
      return local156;
    });
  }
  function findVisualOrderIndex(arg180, arg181) {
    if (!arg180 || !arg181?.size) {
      return Number.MAX_SAFE_INTEGER;
    }
    if (arg181.has(arg180)) {
      return arg181.get(arg180);
    }
    for (const [local158, local159] of arg181.entries()) {
      if (arg180.includes(local158) || local158.includes(arg180)) {
        return local159;
      }
    }
    return Number.MAX_SAFE_INTEGER;
  }
  function readElementImageUrl(arg182) {
    if (!arg182) {
      return null;
    }
    const local160 = arg182.querySelector?.("img");
    const arrayList28 = [local160?.getAttribute("data-lazy-src"), local160?.getAttribute("data-src"), local160?.getAttribute("src"), local160?.src, arg182.style?.backgroundImage, arg182.getAttribute?.("style"), arg182.querySelector?.("[style*='background']")?.style?.backgroundImage, arg182.querySelector?.("[style*='background']")?.getAttribute("style")];
    for (const local161 of arrayList28) {
      const extractedValue65 = normalizeImageUrl(local161 || "");
      if (extractedValue65) {
        return extractedValue65;
      }
    }
    return null;
  }
  function splitSkuSpecAttrs(arg183) {
    return decodeHtmlEntities(arg183).split(/\s*(?:>|;|；)\s*/).map(arg184 => arg184.trim()).filter(Boolean);
  }
  function normalizeSkuKey(arg185) {
    return normalizeCompactText(decodeHtmlEntities(arg185)).toLowerCase();
  }
  function decodeHtmlEntities(arg186) {
    return String(arg186 || "").replace(/&amp;/gi, "&").replace(/&gt;?/gi, ">").replace(/&lt;?/gi, "<").replace(/&quot;?/gi, "\"").replace(/&#39;?/gi, "'").replace(/&#x([0-9a-f]+);?/gi, (arg187, arg188) => String.fromCharCode(parseInt(arg188, 16))).replace(/&#(\d+);?/g, (arg189, arg190) => String.fromCharCode(parseInt(arg190, 10)));
  }
  function cartesianSkuOptions(arg191) {
    if (arg191.length === 0) {
      return [{
        name: "",
        price: null,
        stock: null,
        image: null
      }];
    }
    const [local162, ...value66] = arg191;
    const helperResult322 = cartesianSkuOptions(value66);
    const arrayList29 = [];
    local162.options.forEach(arg192 => {
      helperResult322.forEach(arg193 => {
        arrayList29.push({
          name: [arg192.name, arg193.name].filter(Boolean).join(" ").trim(),
          price: arg193.price || arg192.price || null,
          stock: arg193.stock ?? arg192.stock ?? null,
          image: arg192.image || arg193.image || null
        });
      });
    });
    return arrayList29;
  }
  function isVideoUrl(arg194) {
    return /\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)(?:$|\?)/i.test(String(arg194 || ""));
  }
  function collectImagesFromSelectors(arg195) {
    const arrayList30 = [];
    arg195.forEach(arg196 => {
      document.querySelectorAll(arg196).forEach(arg197 => {
        const extractedValue67 = normalizeImageUrl(arg197.getAttribute("data-lazy-src") || arg197.getAttribute("data-src") || arg197.getAttribute("data-lazyload-src") || arg197.getAttribute("src") || arg197.style?.backgroundImage || arg197.getAttribute("style") || "");
        const extractedValue68 = getImageContext(arg197, arg196);
        if (extractedValue67 && !shouldRejectImage(extractedValue67, extractedValue68)) {
          arrayList30.push(extractedValue67);
        }
      });
    });
    return arrayList30;
  }
  function collectLegacyDetailImages(arg198) {
    const arrayList31 = [];
    if (document.querySelector(".pc-sku-wrapper")) {
      document.querySelectorAll(".content-detail img").forEach(arg199 => {
        const extractedValue69 = getImageContext(arg199, ".content-detail img");
        const extractedValue70 = normalizeImageUrl(arg199.getAttribute("src") || arg199.getAttribute("data-lazyload-src") || "");
        if (!!extractedValue70 && !arg198.has(extractedValue70) && !extractedValue70.includes("assets/") && !shouldRejectImage(extractedValue70, extractedValue69)) {
          arrayList31.push(extractedValue70);
        }
      });
    }
    if (document.querySelector(".next-table-body")) {
      document.querySelectorAll(".detail-description-content img").forEach(arg200 => {
        const extractedValue71 = getImageContext(arg200, ".detail-description-content img");
        const extractedValue72 = normalizeImageUrl(arg200.getAttribute("data-lazyload-src") || arg200.getAttribute("src") || "");
        if (!!extractedValue72 && !arg198.has(extractedValue72) && !extractedValue72.includes("assets/") && !shouldRejectImage(extractedValue72, extractedValue71)) {
          arrayList31.push(extractedValue72);
        }
      });
    }
    const extractedValue73 = querySelectorAcrossShadowRoots("#detail");
    if (extractedValue73) {
      extractedValue73.querySelectorAll("img").forEach(arg201 => {
        const extractedValue74 = getImageContext(arg201, "#detail img");
        const extractedValue75 = normalizeImageUrl(arg201.getAttribute("data-src") || arg201.getAttribute("data-lazyload-src") || arg201.getAttribute("src") || "");
        if (!!extractedValue75 && !arg198.has(extractedValue75) && !extractedValue75.includes("assets/") && !extractedValue75.includes("grey.gif") && !shouldRejectImage(extractedValue75, extractedValue74)) {
          arrayList31.push(extractedValue75);
        }
      });
    }
    return uniqueTruthy(arrayList31);
  }
  function collectDetailImagesFromContainers(arg202) {
    const helperResult27 = function (arg203 = {}) {
      const arrayList32 = [".content-detail", ".detail-description-content", "#detail", ".offer-detail-description", ".module-wap-detail", ".desc-img-loaded", ".detail-content", ".rich-text-description", ".desc-lazyload-container", ".od-detail-container", ".detail-tab-content", ".detail-desc-decorate-richtext"];
      if (arg203?.includeLoose === true) {
        arrayList32.push("[id*='detail']", "[class*='detail']", "[class*='desc']");
      }
      return arrayList32;
    }();
    const arrayList33 = [...collectImagesFromSelectors([".content-detail img", ".detail-description-content img", "#detail img", ".offer-detail-description img", ".module-wap-detail img", ".desc-img-loaded img", ".detail-content img", ".rich-text-description img", ".desc-lazyload-container img", ".od-detail-container img", ".detail-tab-content img", ".detail-desc-decorate-richtext img"])];
    helperResult27.forEach(arg204 => {
      document.querySelectorAll(arg204).forEach(arg205 => {
        arrayList33.push(...collectImagesFromRoot(arg205, arg202));
      });
    });
    return uniqueTruthy(arrayList33.filter(arg206 => !arg202.has(arg206)));
  }
  function collectIframeDetailImages(arg207) {
    const arrayList34 = [];
    document.querySelectorAll("#detail iframe, .content-detail iframe, .detail-description-content iframe, .offer-detail-description iframe, iframe[src*='detail'], iframe[src*='desc']").forEach(arg208 => {
      try {
        const local163 = arg208.contentDocument || arg208.contentWindow?.document;
        if (local163) {
          arrayList34.push(...collectImagesFromRoot(local163, arg207, local163.location?.href || arg208.getAttribute("src") || window.location.href));
        }
      } catch {}
    });
    return uniqueTruthy(arrayList34.filter(arg209 => !arg207.has(arg209)));
  }
  function extractVisibleText(arg210) {
    if (!arg210) {
      return "";
    }
    const local164 = arg210.cloneNode(true);
    local164.querySelectorAll("script,style,noscript,iframe,img,svg,video,source,button").forEach(arg211 => {
      arg211.remove();
    });
    return normalizeText(local164.innerText || local164.textContent || "");
  }
  function querySelectorAcrossShadowRoots(arg212) {
    const local165 = document.querySelector(arg212);
    if (local165) {
      return local165;
    }
    for (const local166 of function () {
      const arrayList35 = [];
      const local167 = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (local167.nextNode()) {
        const local168 = local167.currentNode;
        if (local168.shadowRoot) {
          arrayList35.push(local168.shadowRoot);
        }
      }
      return arrayList35;
    }()) {
      const local169 = local166.querySelector(arg212);
      if (local169) {
        return local169;
      }
    }
    return null;
  }
  function collectImagesFromRoot(arg213, arg214, arg215 = window.location.href) {
    const arrayList36 = [];
    arg213.querySelectorAll("img").forEach(arg216 => {
      const extractedValue76 = getImageContext(arg216, "");
      if ((extractedValue76.width || 0) < 220 && (extractedValue76.height || 0) < 220) {
        return;
      }
      const extractedValue77 = normalizeImageUrl(arg216.getAttribute("data-lazy-src") || arg216.getAttribute("data-src") || arg216.getAttribute("data-lazyload-src") || arg216.getAttribute("src") || "", arg215);
      if (!!extractedValue77 && !arg214.has(extractedValue77) && !shouldRejectImage(extractedValue77, extractedValue76)) {
        arrayList36.push(extractedValue77);
      }
    });
    arg213.querySelectorAll("[style]").forEach(arg217 => {
      const extractedValue78 = getImageContext(arg217, "[style]");
      const extractedValue79 = normalizeImageUrl(arg217.getAttribute("style") || "", arg215);
      if (!!extractedValue79 && !arg214.has(extractedValue79) && !shouldRejectImage(extractedValue79, extractedValue78, {
        requireProductContext: true
      })) {
        arrayList36.push(extractedValue79);
      }
    });
    return uniqueTruthy(arrayList36);
  }
  function normalizeUrl(arg218, arg219 = window.location.href) {
    if (!arg218) {
      return "";
    }
    let local170 = String(arg218).trim().replace(/\\u002F/gi, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&").replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
    if (!local170 || local170 === "about:blank") {
      return "";
    }
    if (local170.startsWith("//")) {
      return "https:" + local170;
    }
    try {
      return new URL(local170, arg219).href;
    } catch {
      return "";
    }
  }
  function normalizeImageUrl(arg220, arg221 = window.location.href) {
    if (!arg220) {
      return null;
    }
    const local171 = String(arg220).trim();
    let scanValue171 = local171;
    const local172 = scanValue171.match(/url\((['"]?)(.*?)\1\)/i);
    if (local172) {
      scanValue171 = local172[2];
    } else if (/[;{}]/.test(local171) || /(?:^|[^\w-])(?:background|color|height|width|margin|padding)\s*:/.test(local171)) {
      return null;
    }
    scanValue171 = normalizeUrl(scanValue171, arg221);
    if (scanValue171) {
      scanValue171 = scanValue171.split("?")[0];
      scanValue171 = scanValue171.replace(/\.sum\.jpg$/i, ".jpg");
      scanValue171 = scanValue171.replace(/\.jpg_.*$/i, ".jpg");
      scanValue171 = scanValue171.replace(/_\.webp$/i, "");
      scanValue171 = scanValue171.replace(/\.webp$/i, "");
      if (!scanValue171 || scanValue171.includes("grey.gif") || scanValue171.includes("empty.png") || scanValue171.includes("lazyload") || scanValue171.includes("tps-48-48") || /(?:^|[-_])48[-x]48(?:[._]|$)/i.test(scanValue171) || isDecorativeImageUrl(scanValue171)) {
        return null;
      } else {
        return scanValue171;
      }
    } else {
      return null;
    }
  }
  function getImageContext(arg222, arg223 = "") {
    const local173 = arg222 && typeof arg222.closest == "function" ? arg222 : null;
    if (!local173) {
      return {
        selector: String(arg223 || "").toLowerCase(),
        text: "",
        width: 0,
        height: 0,
        insideProductContainer: false,
        insideBlockedContainer: false
      };
    }
    const local174 = [arg223, local173.className, local173.id, local173.getAttribute("alt"), local173.getAttribute("title"), local173.getAttribute("aria-label"), local173.getAttribute("data-role"), local173.getAttribute("data-name")].map(arg224 => String(arg224 || "").toLowerCase()).join(" ");
    const local175 = local173.closest("[class*='shop'],[class*='store'],[class*='seller'],[class*='service'],[class*='promise'],[class*='coupon'],[class*='toolbar'],[class*='header'],[class*='footer'],[class*='nav'],[class*='logo'],[class*='icon'],[class*='avatar'],[class*='profile'],[class*='review'],[class*='comment'],[class*='recommend'],[class*='related'],[class*='guess'],[class*='watermark'],[id*='shop'],[id*='store'],[id*='seller'],[id*='service'],[id*='review'],[id*='comment'],[id*='recommend'],[id*='guess']");
    const local176 = local173.closest("[class*='detail'],[class*='desc'],[class*='gallery'],[class*='thumb'],[class*='image'],[class*='sku'],[class*='spec'],[class*='carousel'],[class*='offer'],[id*='detail'],[id*='desc'],[id*='gallery'],[id*='sku']");
    const local177 = Number(local173.getAttribute("width")) || Number(local173.naturalWidth) || Number(local173.width) || Number(local173.offsetWidth) || 0;
    const local178 = Number(local173.getAttribute("height")) || Number(local173.naturalHeight) || Number(local173.height) || Number(local173.offsetHeight) || 0;
    return {
      selector: String(arg223 || "").toLowerCase(),
      text: local174,
      width: local177,
      height: local178,
      insideProductContainer: Boolean(local176),
      insideBlockedContainer: Boolean(local175)
    };
  }
  function shouldRejectImage(arg225, arg226, arg227 = {}) {
    const local179 = String(arg225 || "").toLowerCase();
    const local180 = arg226 || {};
    const local181 = arg227?.requireProductContext === true;
    const local182 = ((local180.selector || "") + " " + (local180.text || "")).toLowerCase();
    const helperResult28 = function (arg228, arg229) {
      const local183 = String(arg228 || "").toLowerCase();
      const local184 = arg229 || {};
      const local185 = ((local184.selector || "") + " " + (local184.text || "")).toLowerCase();
      if (local184.insideProductContainer || /(detail|desc|gallery|thumb|carousel|sku|spec|offer|product|item|商品|主图|详情)/i.test(local185)) {
        return true;
      }
      if (/(detail|desc|gallery|sku|spec|product|item|offer|material)/i.test(local183)) {
        return true;
      }
      const local186 = Number(local184.width) || 0;
      const local187 = Number(local184.height) || 0;
      return local186 >= 320 || local187 >= 320 || local186 * local187 >= 180000;
    }(local179, local180);
    const local188 = /https?:\/\/cbu01\.alicdn\.com\/cms\/upload\//i.test(local179);
    const local189 = local180.insideBlockedContainer || /(avatar|profile|review|comment|shop|store|seller|service|promise|coupon|toolbar|logo|icon|sprite|watermark|placeholder|default|empty|upload|camera|video|play|收藏|客服|店铺|商家|评论|评价|头像|推荐|占位|默认|上传|视频|播放)/i.test(local182);
    const local190 = Number(local180.width) || 0;
    const local191 = Number(local180.height) || 0;
    const local192 = local190 > 0 && local191 > 0 && Math.max(local190, local191) <= 120;
    const local193 = local190 > 0 && local191 > 0 && local190 * local191 <= 20000;
    return !!isDecorativeImageUrl(local179) || !!local181 && !helperResult28 || !!local188 && !helperResult28 || (!!local192 || !!local193) && !helperResult28 || !!local189 && !helperResult28;
  }
  function isDecorativeImageUrl(arg230) {
    const local194 = String(arg230 || "").toLowerCase();
    if (!local194) {
      return false;
    }
    if (local194.includes("img.alicdn.com/tfs/")) {
      return true;
    }
    if (/(grey\.gif|empty\.png|lazyload|tps-48-48|\/avatar(?:\/|_|-|$)|\/logo(?:\/|_|-|$)|\/icon(?:\/|_|-|$)|\/sprite(?:\/|_|-|$)|\/favicon(?:\/|_|-|$)|\/watermark(?:\/|_|-|$)|\/coupon(?:\/|_|-|$)|\/service(?:\/|_|-|$)|\/promise(?:\/|_|-|$)|收藏|客服|店铺|商家)/i.test(local194)) {
      return true;
    }
    const helperResult29 = function (arg231) {
      const local195 = String(arg231 || "").toLowerCase().match(/\/(?:tb|o1cn)[^/?#]*[-_](\d{1,3})[-x](\d{1,3})\.(?:png|jpg|jpeg|webp)$/i);
      if (local195) {
        return {
          width: Number(local195[1]) || 0,
          height: Number(local195[2]) || 0
        };
      } else {
        return null;
      }
    }(local194);
    if (helperResult29 && helperResult29.width <= 120 && helperResult29.height <= 120) {
      return true;
    }
    const helperResult30 = function (arg232) {
      const local196 = String(arg232 || "").toLowerCase().match(/-2-tps-(\d{2,5})-(\d{2,5})\.(?:png|jpg|jpeg|webp)(?:$|[?#])/i);
      if (local196) {
        return {
          width: Number(local196[1]) || 0,
          height: Number(local196[2]) || 0
        };
      } else {
        return null;
      }
    }(local194);
    return !!helperResult30 && !!function (arg233, arg234) {
      const local197 = String(arg233 || "").toLowerCase();
      const local198 = Number(arg234?.width) || 0;
      const local199 = Number(arg234?.height) || 0;
      if (!local198 || !local199) {
        return false;
      }
      const local200 = local198 / Math.max(local199, 1);
      return (!!/https?:\/\/img\.alicdn\.com\/imgextra\//i.test(local197) || !!/https?:\/\/cbu01\.alicdn\.com\/cms\/upload\//i.test(local197)) && (local200 >= 3.2 && local199 <= 260 || local198 >= 700 && local199 <= 180);
    }(local194, helperResult30);
  }
  function uniqueTruthy(arg235) {
    return [...new Set(arg235.filter(Boolean))];
  }
  function readText(arg236) {
    return document.querySelector(arg236)?.innerText?.trim() || "";
  }
  function readChildText(arg237, arg238) {
    return arg237.querySelector(arg238)?.innerText?.trim() || "";
  }
  function normalizeText(arg239) {
    return String(arg239 || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  function normalizeCompactText(arg240) {
    return String(arg240 || "").replace(/\s+/g, "").trim();
  }
  function addPackagingRow(arg241, arg242, arg243, arg244) {
    if (!arg243 || !arg244) {
      return;
    }
    const objectValue19 = {
      label: String(arg243).trim(),
      value: String(arg244).trim()
    };
    if (objectValue19.label && objectValue19.value) {
      arg241.push(objectValue19);
      arg242.push(objectValue19);
    }
  }
  function applyPackagingMeasurement(arg245, arg246, arg247) {
    const helperResult50 = normalizeCompactText(arg246);
    const local201 = String(arg247 || "").trim();
    if (!helperResult50 || !local201) {
      return;
    }
    const extractedValue80 = parseDimensions(local201);
    if (extractedValue80 && /(?:\u5305\u88c5|\u5916\u7bb1|\u88c5\u7bb1|\u7bb1\u89c4|\u957f\u5bbd\u9ad8)/.test(helperResult50)) {
      arg245.length_mm ??= extractedValue80.length_mm;
      arg245.width_mm ??= extractedValue80.width_mm;
      arg245.height_mm ??= extractedValue80.height_mm;
    }
    const extractedValue81 = parseFirstNumber(local201);
    if (extractedValue81 !== null) {
      if (!/(?:^\u91cd\u91cf(?:\(|\uff08|$)|\u6bdb\u91cd|\u51c0\u91cd|\u5305\u88c5\u91cd|\u88c5\u8fd0\u91cd|\u5305\u88c5\u6bdb\u91cd|\u5916\u7bb1\u91cd\u91cf|\u5916\u7bb1\u6bdb\u91cd)/.test(helperResult50) || /(?:\u8f7d\u91cd|\u627f\u91cd|\u8d1f\u91cd|load)/i.test(helperResult50)) {
        if (/(?:\u5305\u88c5\u957f\u5ea6|\u5916\u7bb1\u957f|\u7bb1\u957f|\u957f\u5ea6|^\u957f(?:\(|\uff08|$))/.test(helperResult50)) {
          arg245.length_mm ??= dimensionToMillimeters(local201, extractedValue81);
        } else if (/(?:\u5305\u88c5\u5bbd\u5ea6|\u5916\u7bb1\u5bbd|\u7bb1\u5bbd|\u5bbd\u5ea6|^\u5bbd(?:\(|\uff08|$))/.test(helperResult50)) {
          arg245.width_mm ??= dimensionToMillimeters(local201, extractedValue81);
        } else if (/(?:\u5305\u88c5\u9ad8\u5ea6|\u5916\u7bb1\u9ad8|\u7bb1\u9ad8|\u9ad8\u5ea6|^\u9ad8(?:\(|\uff08|$))/.test(helperResult50)) {
          arg245.height_mm ??= dimensionToMillimeters(local201, extractedValue81);
        }
      } else {
        arg245.weight_g = weightToGrams(local201, extractedValue81);
      }
    }
  }
  function parseDimensions(arg248) {
    const local202 = String(arg248 || "").replace(/\s+/g, "").replace(/[*xX\u00d7]/g, "x");
    const local203 = local202.match(/\d+(?:\.\d+)?/g);
    if (!local203 || local203.length < 3) {
      return null;
    }
    const helperResult31 = function (arg249, arg250) {
      const stringValue2 = String(arg249 || "");
      const local204 = (arg250 || []).slice(0, 3).map(arg251 => Number(arg251)).filter(Number.isFinite);
      if ((/(?:^|[^a-z])m(?:[^a-z]|$)/i.test(stringValue2) || /\u7c73/.test(stringValue2) && !/\u6beb\u7c73|\u5398\u7c73/.test(stringValue2)) && local204.length && Math.max(...local204) >= 10) {
        return stringValue2.replace(/(?:^|[^a-z])m(?:[^a-z]|$)/gi, "mm").replace(/\u7c73/g, "毫米");
      } else {
        return stringValue2;
      }
    }(local202, local203);
    return {
      length_mm: dimensionToMillimeters(helperResult31, Number(local203[0])),
      width_mm: dimensionToMillimeters(helperResult31, Number(local203[1])),
      height_mm: dimensionToMillimeters(helperResult31, Number(local203[2]))
    };
  }
  function parseFirstNumber(arg252) {
    const local205 = String(arg252 || "").match(/\d+(?:\.\d+)?/);
    if (!local205) {
      return null;
    }
    const numericValue7 = Number(local205[0]);
    if (Number.isFinite(numericValue7)) {
      return numericValue7;
    } else {
      return null;
    }
  }
  function dimensionToMillimeters(arg253, arg254) {
    const stringValue3 = String(arg253 || "");
    if (/mm|\u6beb\u7c73/i.test(stringValue3)) {
      return Math.round(arg254);
    } else if (/cm|\u5398\u7c73/i.test(stringValue3)) {
      return Math.round(arg254 * 10);
    } else if (/(?:^|[^a-z])m(?:[^a-z]|$)/i.test(stringValue3) || /\u7c73/.test(stringValue3) && !/\u6beb\u7c73|\u5398\u7c73/.test(stringValue3)) {
      return Math.round(arg254 * 1000);
    } else {
      return Math.round(arg254 * 10);
    }
  }
  function weightToGrams(arg255, arg256) {
    const stringValue4 = String(arg255 || "");
    if (/kg|\u5343\u514b|\u516c\u65a4/i.test(stringValue4)) {
      return Math.round(arg256 * 1000);
    } else if (/\u65a4/.test(stringValue4)) {
      return Math.round(arg256 * 500);
    } else {
      return Math.round(arg256);
    }
  }
  window.SS_ERP_DONOR_STRATEGIES = window.SS_ERP_DONOR_STRATEGIES || {};
  window.SS_ERP_DONOR_STRATEGIES.adapter1688 = {
    name: "1688",
    matches: arg257 => arg257.includes("detail.1688.com"),
    scrape: scrape1688Product
  };
})();
