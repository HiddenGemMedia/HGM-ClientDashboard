(function () {
  const moneyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
  const monthFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric"
  });
  const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  });

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMoney(value) {
    return moneyFormatter.format(Number(value) || 0);
  }

  function formatPercent(value) {
    return Math.round(Number(value) || 0) + "%";
  }

  function formatMonth(value) {
    if (!value) {
      return "Current Pricing Horizon";
    }
    const parsed = new Date(value + "-01T00:00:00");
    return Number.isNaN(parsed.getTime()) ? "Current Pricing Horizon" : monthFormatter.format(parsed);
  }

  function formatShortDate(value) {
    if (!value) {
      return "-";
    }
    const parsed = new Date(value + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? value : shortDateFormatter.format(parsed);
  }

  function formatSnapshotDate(value) {
    if (!value) {
      return "latest export";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return parsed.toISOString().slice(0, 10) + ".json";
  }

  function normalizeData(data) {
    if (!data || !data.windows) {
      return null;
    }

    const listings = {};
    const windowKeys = Object.keys(data.windows)
      .filter(function (key) {
        return data.windows[key] && Array.isArray(data.windows[key].all);
      })
      .sort(function (left, right) {
        return Number(left) - Number(right);
      });

    if (!windowKeys.length) {
      return null;
    }

    windowKeys.forEach(function (windowKey) {
      data.windows[windowKey].all.forEach(function (row) {
        const id = row.id || row.name;
        if (!id) {
          return;
        }
        if (!listings[id]) {
          listings[id] = {
            id: id,
            name: row.name || row.nickname || "Listing",
            nickname: row.nickname || row.name || "Listing",
            city: row.city || "",
            state: row.state || "",
            basePrice: Number(row.basePrice) || 0,
            windows: {},
            totalPotentialRevenue: 0
          };
        }

        listings[id].windows[windowKey] = {
          totalDays: Number(row.totalDays) || 0,
          bookedDays: Number(row.bookedDays) || 0,
          availableDays: Number(row.availableDays) || 0,
          occupancyRate: Number(row.occupancyRate) || 0,
          potentialRevenue: Number(row.potentialRevenue) || 0,
          recommendations: Array.isArray(row.recommendations) ? row.recommendations : []
        };
        listings[id].totalPotentialRevenue += Number(row.potentialRevenue) || 0;
      });
    });

    const allListings = Object.keys(listings).map(function (id) {
      const listing = listings[id];
      listing.searchText = [
        listing.name,
        listing.nickname,
        listing.city,
        listing.state
      ].join(" ").toLowerCase();
      return listing;
    }).sort(function (left, right) {
      return left.nickname.localeCompare(right.nickname);
    });

    return {
      totalListings: Number(data.totalListings) || allListings.length,
      generatedAt: data.generatedAt || "",
      threshold: Number(data.threshold) || 0,
      windowKeys: windowKeys,
      listings: allListings,
      states: Array.from(new Set(allListings.map(function (listing) {
        return listing.state;
      }).filter(Boolean))).sort()
    };
  }

  function getWindowSummary(listings, windowKey) {
    return listings.reduce(function (summary, listing) {
      const windowData = listing.windows[windowKey] || {};
      const recommendations = windowData.recommendations || [];
      const occupancyRate = Number(windowData.occupancyRate) || 0;
      const availableDays = Number(windowData.availableDays) || 0;
      summary.totalOccupancy += occupancyRate;
      summary.openValue += Number(windowData.potentialRevenue) || 0;
      if (availableDays <= 5) {
        summary.nearingFull += 1;
      }
      if (recommendations.length) {
        summary.actionable += 1;
      }
      return summary;
    }, {
      totalOccupancy: 0,
      openValue: 0,
      nearingFull: 0,
      actionable: 0
    });
  }

  function getAvgOccupancy(listings, windowKey) {
    if (!listings.length) {
      return 0;
    }
    return getWindowSummary(listings, windowKey).totalOccupancy / listings.length;
  }

  function buildLeadTimeLine(model, windowKey) {
    const listings = model.listings;
    const gapCount = listings.filter(function (listing) {
      const windowData = listing.windows[windowKey] || {};
      return Number(windowData.availableDays) > 0;
    }).length;
    const soldOutCount = listings.filter(function (listing) {
      const windowData = listing.windows[windowKey] || {};
      return Number(windowData.availableDays) <= 0;
    }).length;
    const actionableCount = listings.filter(function (listing) {
      const windowData = listing.windows[windowKey] || {};
      return Array.isArray(windowData.recommendations) && windowData.recommendations.length > 0;
    }).length;
    const avgOccupancy = Math.round(getAvgOccupancy(listings, windowKey));
    const label = windowKey + "-day";

    if (windowKey === "30") {
      return "<strong>" + label + ":</strong> " + gapCount + " of " + listings.length + " cabins still have open nights, while " + soldOutCount + " unit" + (soldOutCount === 1 ? " is" : "s are") + " already sold out. This window still needs tactical fills more than broad discounting.";
    }
    if (windowKey === "60") {
      return "<strong>" + label + ":</strong> Occupancy is averaging " + avgOccupancy + "%, with " + actionableCount + " cabins showing active pricing opportunities. The middle runway is where positioning and rate discipline can still reshape pace.";
    }
    return "<strong>" + label + ":</strong> All " + listings.length + " cabins still have bookable runway, and portfolio occupancy sits at " + avgOccupancy + "%. This longer horizon is best used to protect premium weekends while packaging the softer stays more intentionally.";
  }

  function renderLeadTimeInline(model, windowKey) {
    return [
      '<div class="leadtime-inline">',
      '<div class="leadtime-inline-kicker">Booking Lead Time</div>',
      '<p class="leadtime-inline-copy">' + buildLeadTimeLine(model, windowKey) + '</p>',
      "</div>"
    ].join("");
  }

  function renderInsightCards(model) {
    return [
      '<section class="pricing-insights" aria-label="Pricing insights">',
      '<article class="insight-card insight-card-context">',
      '<div class="insight-kicker">Event Context This Window</div>',
      '<p class="insight-copy insight-copy-serif">Snapshot used: ' + escapeHtml(formatSnapshotDate(model.generatedAt)) + '. Live event coverage was unavailable in this run, so the demand read falls back to recurring Asheville drive-market and holiday patterns.</p>',
      '</article>',
      "</section>"
    ].join("");
  }

  function hmColor(value) {
    const occupancy = Number(value) || 0;

    function lerp(a, b, t) {
      return Math.round(a + (b - a) * t);
    }
    function blendHex(hex1, hex2, t) {
      const r1 = parseInt(hex1.slice(1,3),16), g1 = parseInt(hex1.slice(3,5),16), b1 = parseInt(hex1.slice(5,7),16);
      const r2 = parseInt(hex2.slice(1,3),16), g2 = parseInt(hex2.slice(3,5),16), b2 = parseInt(hex2.slice(5,7),16);
      return '#' + [lerp(r1,r2,t), lerp(g1,g2,t), lerp(b1,b2,t)].map(v => v.toString(16).padStart(2,'0')).join('');
    }

    if (occupancy >= 90) {
      // green: 90% = medium, 100% = rich
      const t = (occupancy - 90) / 10;
      return blendHex("#3db76a", "#16a34a", t);
    }
    if (occupancy >= 60) {
      // blue: 60% = medium, 89% = rich
      const t = (occupancy - 60) / 29;
      return blendHex("#6089ee", "#2d59e0", t);
    }
    if (occupancy >= 40) {
      // amber: 40% = medium, 59% = rich
      const t = (occupancy - 40) / 19;
      return blendHex("#f7b236", "#e8920a", t);
    }
    // red: 0% = palest, 39% = slightly deeper
    const t = occupancy / 39;
    return blendHex("#fbbfbf", "#f87171", t);
  }

  function hmOpacity(value) {
    return 1;
  }

  function occClass(value) {
    const occupancy = Number(value) || 0;
    if (occupancy >= 90) {
      return "full";
    }
    if (occupancy >= 60) {
      return "high";
    }
    if (occupancy >= 40) {
      return "mid";
    }
    return "low";
  }

  function directionClass(changePercent) {
    if ((Number(changePercent) || 0) > 0) {
      return "up";
    }
    if ((Number(changePercent) || 0) < 0) {
      return "dn";
    }
    return "flat";
  }

  function topRecommendation(listing, windowKey) {
    const primaryWindow = listing.windows[windowKey] || {};
    const primaryRecommendations = primaryWindow.recommendations || [];
    if (primaryRecommendations.length) {
      return primaryRecommendations[0];
    }
    const fallbacks = Object.keys(listing.windows).reduce(function (rows, key) {
      return rows.concat(listing.windows[key].recommendations || []);
    }, []);
    return fallbacks[0] || null;
  }

  function topRecommendationLabel(listing, windowKey) {
    const recommendation = topRecommendation(listing, windowKey);
    if (!recommendation) {
      return '<span class="top-rec neutral">No open opportunities</span>';
    }
    const change = Number(recommendation.changePercent) || 0;
    const sign = change > 0 ? "+" : "";
    return '<span class="top-rec ' + directionClass(change) + '">' +
      escapeHtml(sign + Math.round(change) + "% " + formatShortDate(recommendation.date) + " -> " + formatMoney(recommendation.recommendedPrice)) +
      "</span>";
  }

  function sparkHTML(listing) {
    return '<div class="sparkbar-wrap">' + ["30", "60", "90"].map(function (windowKey) {
      const windowData = listing.windows[windowKey] || {};
      const occupancy = Number(windowData.occupancyRate) || 0;
      const height = Math.max(4, Math.round((occupancy / 100) * 22));
      return '<div class="sparkbar-col" style="height:' + height + 'px;background:' + hmColor(occupancy) + ';opacity:' + (hmOpacity(occupancy) + 0.18) + '" title="' + escapeHtml(windowKey + 'D: ' + formatPercent(occupancy)) + '"></div>';
    }).join("") + "</div>";
  }

  function rowDomId(listingId) {
    return "pricing-row-" + String(listingId).replace(/[^a-zA-Z0-9_-]/g, "");
  }

  function nightGridDetail(windowData) {
    const booked = Number(windowData.bookedDays) || 0;
    const total = Number(windowData.totalDays) || 0;
    const cls = occClass(windowData.occupancyRate);
    let html = "";
    for (let index = 0; index < total; index += 1) {
      html += '<div class="dw-ngrid-cell ' + (index < booked ? "on " + cls : "off " + cls) + '"></div>';
    }
    return html;
  }

  function renderWindowDetail(listing, windowKey) {
    const windowData = listing.windows[windowKey];
    if (!windowData) {
      return "";
    }
    const recommendationRows = (windowData.recommendations || []).length
      ? '<div class="dw-rec-head"><div>Date</div><div>Current</div><div>Suggested</div><div>Why</div></div>' +
        windowData.recommendations.slice(0, 4).map(function (row) {
          const change = Number(row.changePercent) || 0;
          const sign = change > 0 ? "+" : "";
          return '<div class="dw-rec-row">' +
            '<div class="dw-rec-date">' + escapeHtml(formatShortDate(row.date)) + '</div>' +
            '<div class="dw-rec-curr">' + escapeHtml(formatMoney(row.currentPrice)) + '</div>' +
            '<div class="dw-rec-sug ' + directionClass(change) + '">' +
              escapeHtml(formatMoney(row.recommendedPrice)) +
              '<br><span class="dw-rec-badge ' + directionClass(change) + '">' + escapeHtml(sign + Math.round(change) + "%") + "</span>" +
            '</div>' +
            '<div class="dw-rec-why">' + escapeHtml(row.reason || "Pricing signal detected from demand and availability.") + "</div>" +
          "</div>";
        }).join("")
      : '<div class="dw-empty">No price moves recommended in this window.</div>';

    return '<div class="dw-two-card-layout">' +
      '<div class="detail-win dw-card-left">' +
        '<div class="dw-summary">' +
          '<div class="dw-summary-kicker">Occupancy Rate</div>' +
          '<div class="dw-summary-hero">' +
            '<div class="dw-ring dw-ring-' + occClass(windowData.occupancyRate) + '" style="--dw-ring-value:' + Math.max(0, Math.min(100, Number(windowData.occupancyRate) || 0)) + '%"></div>' +
            '<div class="dw-summary-copy">' +
              '<span class="dw-occ ' + occClass(windowData.occupancyRate) + '">' + escapeHtml(formatPercent(windowData.occupancyRate)) + "</span>" +
              '<span class="dw-summary-ratio">' + escapeHtml(String(windowData.bookedDays) + "/" + String(windowData.totalDays) + " booked") + "</span>" +
            "</div>" +
          "</div>" +
          '<div class="dw-label dw-grid-head"><span>Night Fill</span><span class="dw-open-pill">' + escapeHtml(String(windowData.availableDays) + " Open") + '</span></div>' +
          '<div class="dw-ngrid">' + nightGridDetail(windowData) + "</div>" +
          '<div class="dw-revenue-card">' +
            '<div class="dw-revenue-value">' + escapeHtml(formatMoney(windowData.potentialRevenue)) + "</div>" +
            '<div class="dw-revenue-label">Potential Revenue · ' + escapeHtml(windowKey + "D Window") + "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="detail-win dw-card-right">' +
        '<div class="dw-detail-main">' +
          recommendationRows +
        "</div>" +
      "</div>" +
    "</div>";
  }

  function renderTabbedWindowDetail(listing, windowKeys, activeWindow, rowId) {
    const selectedWindow = listing.windows[activeWindow] ? activeWindow : windowKeys[0];
    return '<div class="detail-panel">' +
      renderWindowDetail(listing, selectedWindow) +
    "</div>";
  }

  function heatmapRows(model) {
    return model.listings.map(function (listing) {
      const rowId = rowDomId(listing.id);
      return '<div class="hm-row">' +
        '<div class="hm-name" title="' + escapeHtml(listing.nickname) + '">' + escapeHtml(listing.nickname.length > 28 ? listing.nickname.slice(0, 26) + "..." : listing.nickname) + "</div>" +
        '<div class="hm-bars">' +
          ["30", "60", "90"].map(function (windowKey) {
            const windowData = listing.windows[windowKey] || {};
            const occupancy = Number(windowData.occupancyRate) || 0;
            return '<button class="hm-seg hm-seg-' + windowKey + ' hm-seg-' + occClass(occupancy) + '" type="button" data-heatmap-jump="' + escapeHtml(rowId) + '" data-heatmap-window="' + escapeHtml(windowKey) + '" style="background:' + hmColor(occupancy) + ";opacity:" + hmOpacity(occupancy) + '" title="' + escapeHtml(windowKey + "D: " + formatPercent(occupancy)) + '">' + escapeHtml(formatPercent(occupancy)) + "</button>";
          }).join("") +
        "</div>" +
      "</div>";
    }).join("");
  }

  function filteredListings(model, viewState) {
    return model.listings.filter(function (listing) {
      const matchesState = viewState.filterState === "ALL" || listing.state === viewState.filterState;
      const matchesSearch = !viewState.search || listing.searchText.indexOf(viewState.search.toLowerCase()) !== -1;
      return matchesState && matchesSearch;
    }).sort(function (left, right) {
      if (viewState.sortKey === "name") {
        return left.nickname.localeCompare(right.nickname);
      }
      if (viewState.sortKey === "opportunity") {
        return right.totalPotentialRevenue - left.totalPotentialRevenue;
      }
      if (viewState.sortKey === "30") {
        return ((right.windows["30"] && right.windows["30"].occupancyRate) || 0) - ((left.windows["30"] && left.windows["30"].occupancyRate) || 0);
      }
      if (viewState.sortKey === "90") {
        return ((right.windows["90"] && right.windows["90"].occupancyRate) || 0) - ((left.windows["90"] && left.windows["90"].occupancyRate) || 0);
      }
      return (((right.windows[viewState.activeWindow] || {}).potentialRevenue) || 0) - ((((left.windows[viewState.activeWindow] || {}).potentialRevenue) || 0));
    });
  }

  function renderEmpty(container, clientName, selectedMonth) {
    container.innerHTML = '<div class="pricing-ref-shell"><div class="pp-wrap"><section id="pricing-overview" class="section visible"><header class="pp-header"><h1>' +
      escapeHtml(clientName || "Pricing Tool") +
      '</h1><div class="pp-eyebrow">Pricing Tool</div><div class="pp-subtitle">' +
      escapeHtml(formatMonth(selectedMonth)) +
      '</div></header><div class="pricing-empty-card">Pricing data is not available yet for this client.</div></section></div></div>';
  }

  function render(container, options) {
    const model = normalizeData(options && options.data);
    if (!model) {
      renderEmpty(container, options && options.client && options.client.name, options && options.selectedMonth);
      return;
    }

    const state = container.__pricingToolState || {
      activeWindow: "30",
      filterState: "ALL",
      search: "",
      sortKey: "name",
      openRowId: "",
      detailWindowByRow: {},
      pendingScrollRowId: ""
    };
    container.__pricingToolState = state;

    if (model.windowKeys.indexOf(state.activeWindow) === -1) {
      state.activeWindow = model.windowKeys[0];
    }

    const visibleListings = filteredListings(model, state);
    const summary = getWindowSummary(model.listings, state.activeWindow);
    const averageOccupancy = getAvgOccupancy(model.listings, state.activeWindow);
    container.innerHTML = [
      '<div class="pricing-ref-shell">',
      '<div class="pp-wrap">',
      '<section id="pricing-overview" class="section visible pricing-ref-hero">',
      '<header class="pp-header">',
      '<h1>', escapeHtml(options.client && options.client.name ? options.client.name : "Pricing Tool"), "</h1>",
      '<div class="pp-eyebrow">Pricing Tool</div>',
      '<div class="pp-subtitle">Revenue intelligence for ', escapeHtml(formatMonth(options.selectedMonth)), "</div>",
      '</header>',
      '<div class="pricing-kpi-bar">',
      '<div class="pricing-kpi-cards">',
      '<div class="kpi-card"><div class="kpi-val white">' + escapeHtml(String(summary.nearingFull)) + '</div><div class="kpi-lbl">Nearing Full</div></div>',
      '<div class="kpi-card"><div class="kpi-val sage">' + escapeHtml(formatPercent(averageOccupancy)) + '</div><div class="kpi-lbl">Avg Occupancy</div></div>',
      '<div class="kpi-card"><div class="kpi-val gold">' + escapeHtml(formatMoney(summary.openValue)) + '</div><div class="kpi-lbl">Open Value</div></div>',
      "</div>",
      '<div class="kpi-bar-divider"></div>',
      '<div class="kpi-right-panel">',
      '<div class="kpi-win-tabs">',
      model.windowKeys.map(function (windowKey) {
        return '<button class="kpi-win-btn ' + (state.activeWindow === windowKey ? "on" : "") + '" type="button" data-pricing-window="' + escapeHtml(windowKey) + '">' + escapeHtml(windowKey + "D") + "</button>";
      }).join(""),
      "</div>",
      renderLeadTimeInline(model, state.activeWindow),
      "</div>",
      "</div>",
      renderInsightCards(model),
      "</section>",

      '<section class="section visible" id="pricing-heatmap">',
      '<div class="heatmap-wrap">',
      '<div class="heatmap-title">Portfolio Occupancy at a Glance</div>',
      '<div class="heatmap-sub">30D, 60D, 90D occupancy across all ' + escapeHtml(String(model.totalListings)) + ' listings. Color intensity reflects booking density.</div>',
      '<div class="heatmap-legend" aria-label="Occupancy legend">' +
        '<span class="heatmap-legend-item"><span class="heatmap-legend-swatch full"></span>90%-100%</span>' +
        '<span class="heatmap-legend-item"><span class="heatmap-legend-swatch high"></span>60%-89%</span>' +
        '<span class="heatmap-legend-item"><span class="heatmap-legend-swatch mid"></span>40%-59%</span>' +
        '<span class="heatmap-legend-item"><span class="heatmap-legend-swatch low"></span>Under 40%</span>' +
      '</div>',
      '<div class="heatmap-grid">', heatmapRows(model), "</div>",
      "</div>",
      "</section>",

      '<section class="section visible" id="pricing-listings">',
      '<div class="sec-label"><div class="sec-label-line"></div><div class="sec-label-text">All Listings · Click Any Row To Expand</div><div class="sec-label-line"></div></div>',
      '<div class="pricing-controls">',
      '<div class="pricing-filter-group"><span class="filter-label">Filter:</span>',
      '<button class="filter-chip ' + (state.filterState === "ALL" ? "active" : "") + '" type="button" data-pricing-filter="ALL">All</button>',
      model.states.map(function (code) {
        return '<button class="filter-chip ' + (state.filterState === code ? "active" : "") + '" type="button" data-pricing-filter="' + escapeHtml(code) + '"><span class="filter-dot" style="background:' + hmColor(65 + (code.charCodeAt(0) % 20)) + '"></span>' + escapeHtml(code) + "</button>";
      }).join(""),
      "</div>",
      '<div class="pricing-search-group">',
      '<div class="search-shell"><input class="search-input" id="pricingSearchInput" type="text" placeholder="Search listings..." value="' + escapeHtml(state.search) + '"></div>',
      '<div class="sort-shell"><label for="pricingSortSelect">Sort</label><select id="pricingSortSelect" class="sort-select"><option value="name"' + (state.sortKey === "name" ? " selected" : "") + '>A-Z</option><option value="window-value"' + (state.sortKey === "window-value" ? " selected" : "") + '>Top opportunity</option><option value="30"' + (state.sortKey === "30" ? " selected" : "") + '>Highest 30D occupancy</option><option value="90"' + (state.sortKey === "90" ? " selected" : "") + '>Highest 90D occupancy</option><option value="opportunity"' + (state.sortKey === "opportunity" ? " selected" : "") + '>Highest total value</option></select></div>',
      "</div>",
      "</div>",
      '<div class="port-table-wrap"><table class="port-table"><thead class="pt-head"><tr><th>Listing</th><th>30D</th><th>60D</th><th>90D</th><th>Trend</th><th style="text-align:center">Top Recommendation</th><th></th></tr></thead><tbody>',
      visibleListings.map(function (listing) {
        const rowId = rowDomId(listing.id);
        const isOpen = state.openRowId === rowId;
        const activeWin = isOpen ? (state.detailWindowByRow[rowId] || state.activeWindow) : null;
        return '<tr class="pt-row' + (isOpen ? " active" : "") + '" data-pricing-row="' + escapeHtml(rowId) + '">' +
          '<td><div class="pt-name">' + escapeHtml(listing.nickname) + '</div><div class="pt-loc">' + escapeHtml([listing.city, listing.state].filter(Boolean).join(", ")) + '</div></td>' +
          '<td style="text-align:center"><span class="occ-pill ' + occClass(listing.windows["30"] && listing.windows["30"].occupancyRate) + (isOpen && activeWin === "30" ? " pill-active" : "") + '" data-pricing-pill="30" data-pricing-row="' + escapeHtml(rowId) + '">' + escapeHtml(formatPercent(listing.windows["30"] && listing.windows["30"].occupancyRate)) + "</span></td>" +
          '<td style="text-align:center"><span class="occ-pill ' + occClass(listing.windows["60"] && listing.windows["60"].occupancyRate) + (isOpen && activeWin === "60" ? " pill-active" : "") + '" data-pricing-pill="60" data-pricing-row="' + escapeHtml(rowId) + '">' + escapeHtml(formatPercent(listing.windows["60"] && listing.windows["60"].occupancyRate)) + "</span></td>" +
          '<td style="text-align:center"><span class="occ-pill ' + occClass(listing.windows["90"] && listing.windows["90"].occupancyRate) + (isOpen && activeWin === "90" ? " pill-active" : "") + '" data-pricing-pill="90" data-pricing-row="' + escapeHtml(rowId) + '">' + escapeHtml(formatPercent(listing.windows["90"] && listing.windows["90"].occupancyRate)) + "</span></td>" +
          "<td>" + sparkHTML(listing) + "</td>" +
          '<td style="text-align:center">' + topRecommendationLabel(listing, state.activeWindow) + "</td>" +
          '<td style="text-align:right"><span class="expand-icon">' + (isOpen ? "−" : "+") + "</span></td>" +
        "</tr>" +
        '<tr class="detail-row' + (isOpen ? " open" : "") + '" id="' + escapeHtml(rowId + "-detail") + '"><td class="detail-cell" colspan="7"><div class="detail-inner">' +
          renderTabbedWindowDetail(listing, model.windowKeys, state.detailWindowByRow[rowId] || state.activeWindow, rowId) +
        "</div></td></tr>";
      }).join(""),
      (visibleListings.length ? "" : '<tr><td colspan="7"><div class="pricing-no-results">No listings match this filter.</div></td></tr>'),
      "</tbody></table></div>",
      "</section>",
      "</div>",
      "</div>"
    ].join("");

    Array.prototype.forEach.call(container.querySelectorAll("[data-pricing-window]"), function (button) {
      button.addEventListener("click", function () {
        state.activeWindow = button.getAttribute("data-pricing-window");
        render(container, options);
      });
    });

    Array.prototype.forEach.call(container.querySelectorAll("[data-pricing-filter]"), function (button) {
      button.addEventListener("click", function () {
        state.filterState = button.getAttribute("data-pricing-filter") || "ALL";
        state.openRowId = "";
        state.pendingScrollRowId = "";
        render(container, options);
      });
    });

    const searchInput = container.querySelector("#pricingSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        const scrollY = window.scrollY;
        state.search = searchInput.value || "";
        state.openRowId = "";
        state.pendingScrollRowId = "";
        render(container, options);
        window.scrollTo({ top: scrollY, behavior: "instant" });
        const newInput = container.querySelector("#pricingSearchInput");
        if (newInput) {
          newInput.focus();
          const len = newInput.value.length;
          newInput.setSelectionRange(len, len);
        }
      });
    }

    const sortSelect = container.querySelector("#pricingSortSelect");
    if (sortSelect) {
      sortSelect.addEventListener("change", function () {
        state.sortKey = sortSelect.value || "window-value";
        state.openRowId = "";
        state.pendingScrollRowId = "";
        render(container, options);
      });
    }

    Array.prototype.forEach.call(container.querySelectorAll("[data-pricing-pill]"), function (pill) {
      pill.addEventListener("click", function (event) {
        event.stopPropagation();
        const rowId = pill.getAttribute("data-pricing-row") || "";
        const windowKey = pill.getAttribute("data-pricing-pill") || state.activeWindow;
        const alreadyOpen = state.openRowId === rowId && state.detailWindowByRow[rowId] === windowKey;
        if (alreadyOpen) {
          state.openRowId = "";
        } else {
          state.openRowId = rowId;
          state.detailWindowByRow[rowId] = windowKey;
        }
        state.pendingScrollRowId = "";
        render(container, options);
      });
    });

    Array.prototype.forEach.call(container.querySelectorAll("[data-pricing-row]"), function (row) {
      if (row.getAttribute("data-pricing-pill")) return;
      row.addEventListener("click", function () {
        const rowId = row.getAttribute("data-pricing-row") || "";
        state.openRowId = state.openRowId === rowId ? "" : rowId;
        if (state.openRowId && !state.detailWindowByRow[rowId]) {
          state.detailWindowByRow[rowId] = state.activeWindow;
        }
        state.pendingScrollRowId = "";
        render(container, options);
      });
    });

    Array.prototype.forEach.call(container.querySelectorAll("[data-heatmap-jump]"), function (button) {
      button.addEventListener("click", function () {
        const rowId = button.getAttribute("data-heatmap-jump") || "";
        const windowKey = button.getAttribute("data-heatmap-window") || state.activeWindow;
        state.openRowId = rowId;
        state.detailWindowByRow[rowId] = windowKey;
        state.pendingScrollRowId = rowId;
        render(container, options);
      });
    });

    Array.prototype.forEach.call(container.querySelectorAll("[data-detail-tab]"), function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        const rowId = button.getAttribute("data-detail-row") || "";
        const windowKey = button.getAttribute("data-detail-tab") || state.activeWindow;
        state.detailWindowByRow[rowId] = windowKey;
        state.openRowId = rowId;
        state.pendingScrollRowId = "";
        render(container, options);
      });
    });

    if (state.pendingScrollRowId) {
      const scrollTarget = container.querySelector("#" + state.pendingScrollRowId + "-detail");
      state.pendingScrollRowId = "";
      if (scrollTarget) {
        window.requestAnimationFrame(function () {
          scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  }

  window.PricingToolModule = {
    render: render
  };
})();
