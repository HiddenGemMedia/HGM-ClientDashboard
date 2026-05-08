(function () {
  const config = window.DASHBOARD_CONFIG || {};
  const tables = config.tables || {};
  const benchmarks = config.benchmarks || {};
  const monthPalette = ["#7c3aed", "#0891b2", "#16a34a"];
  const monthLightPalette = ["#f5f3ff", "#ecfeff", "#f0fdf4"];

  const state = {
    supabase: null,
    clientSlug: "",
    month: "",
    activeView: "current",
    currentClient: null,
    availableClients: [],
    campaignRows: [],
    comparisonRows: [],
    comparisonMonths: [],
    charts: []
  };

  const els = {
    clientSelect: document.getElementById("clientSelect"),
    monthInput: document.getElementById("monthInput"),
    loadButton: document.getElementById("loadButton"),
    refreshButton: document.getElementById("refreshButton"),
    heroBrandMonth: document.getElementById("heroBrandMonth"),
    statusMessage: document.getElementById("statusMessage"),
    currentView: document.getElementById("currentView"),
    comparisonView: document.getElementById("comparisonView"),
    navLinks: Array.from(document.querySelectorAll(".nav-link"))
  };

  function init() {
    if (!window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) {
      setStatus("Add a valid Supabase project URL and anon key in dashboard.config.js.", "error");
      return;
    }

    state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    bindUi();
    hydrateRoute();
    loadDashboard();
  }

  function bindUi() {
    els.loadButton.addEventListener("click", function () {
      state.clientSlug = els.clientSelect.value;
      state.month = els.monthInput.value;
      loadDashboard();
    });

    els.refreshButton.addEventListener("click", function () {
      loadDashboard(true);
    });

    els.clientSelect.addEventListener("change", function () {
      state.clientSlug = els.clientSelect.value;
    });

    els.monthInput.addEventListener("change", function () {
      state.month = els.monthInput.value;
      updateRoute(state.month, state.clientSlug, state.activeView);
      renderSidebarMonth();
      loadAvailableClientsOnly();
    });

    els.navLinks.forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        state.activeView = link.getAttribute("data-view");
        updateRoute(state.month, state.clientSlug, state.activeView);
        renderViews();
      });
    });
  }

  function hydrateRoute() {
    const params = new URLSearchParams(window.location.search);
    state.month = params.get("month") || config.defaults.month || "";
    state.clientSlug = params.get("client") || config.defaults.client || "";
    state.activeView = params.get("view") || "current";
    if (!state.month) {
      state.month = currentMonthKey();
    }
    els.monthInput.value = state.month;
    renderSidebarMonth();
  }

  async function loadDashboard(force) {
    if (!state.month) {
      setStatus("Choose a month to load the dashboard.", "error");
      return;
    }

    try {
      setLoading(true);
      setStatus("Loading dashboard from Supabase...", "info");
      updateRoute(state.month, state.clientSlug, state.activeView);
      await loadAvailableClients();
      if (!state.clientSlug && state.availableClients.length) {
        state.clientSlug = state.availableClients[0].slug;
      }
      if (!state.clientSlug) {
        state.currentClient = null;
        state.campaignRows = [];
        state.comparisonRows = [];
        renderViews();
        setStatus("No clients with data were found for this month.", "error");
        return;
      }

      state.currentClient = await fetchClientBySlug(state.clientSlug);
      if (!state.currentClient) {
        throw new Error("The selected client could not be found in the clients table.");
      }

      state.campaignRows = await fetchRowsForMonth(state.currentClient.id, state.month);
      state.comparisonMonths = getComparisonMonths(state.month);
      state.comparisonRows = await fetchRowsForComparison(state.currentClient.id, state.comparisonMonths);

      renderViews();
      setStatus("", "");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Could not load the dashboard.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadAvailableClientsOnly() {
    try {
      setLoading(true);
      await loadAvailableClients();
      renderSidebarMonth();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function loadAvailableClients() {
    const parts = parseMonthKey(state.month);
    const { data, error } = await state.supabase
      .from(tables.monthlyAds)
      .select("client_id")
      .eq("year", parts.year)
      .eq("month", parts.month);

    if (error) {
      throw new Error("Could not load clients with data for the selected month.");
    }

    const ids = Array.from(new Set((data || []).map(function (row) { return row.client_id; }).filter(Boolean)));
    if (!ids.length) {
      state.availableClients = [];
      renderClientOptions();
      return;
    }

    const clientResponse = await state.supabase
      .from(tables.clients)
      .select("id, name, slug, status")
      .in("id", ids)
      .order("name", { ascending: true });

    if (clientResponse.error) {
      throw new Error("Could not load client names for the selected month.");
    }

    state.availableClients = clientResponse.data || [];
    if (state.clientSlug && !state.availableClients.some(function (client) { return client.slug === state.clientSlug; })) {
      state.clientSlug = "";
    }
    renderClientOptions();
  }

  async function fetchClientBySlug(slug) {
    const { data, error } = await state.supabase
      .from(tables.clients)
      .select("id, name, slug, status, metadata")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      throw new Error("Could not load the selected client.");
    }
    return data || null;
  }

  async function fetchRowsForMonth(clientId, monthKey) {
    const parts = parseMonthKey(monthKey);
    const { data, error } = await state.supabase
      .from(tables.monthlyAds)
      .select("*")
      .eq("client_id", clientId)
      .eq("year", parts.year)
      .eq("month", parts.month)
      .order("campaign_type", { ascending: true });

    if (error) {
      throw new Error("Could not load monthly_ad_data rows for the selected month.");
    }
    return sortCampaignRows(data || []);
  }

  async function fetchRowsForComparison(clientId, months) {
    const queries = months.map(function (item) {
      return state.supabase
        .from(tables.monthlyAds)
        .select("*")
        .eq("client_id", clientId)
        .eq("year", item.year)
        .eq("month", item.month)
        .order("campaign_type", { ascending: true });
    });

    const results = await Promise.all(queries);
    const rows = [];
    results.forEach(function (result) {
      if (result.error) {
        throw new Error("Could not load comparison rows from monthly_ad_data.");
      }
      (result.data || []).forEach(function (row) { rows.push(row); });
    });
    return sortComparisonRows(rows);
  }

  function renderClientOptions() {
    const options = ['<option value="">Choose a client</option>'].concat(
      state.availableClients.map(function (client) {
        return '<option value="' + escapeHtml(client.slug) + '">' + escapeHtml(client.name) + "</option>";
      })
    );
    els.clientSelect.innerHTML = options.join("");
    if (state.clientSlug) {
      els.clientSelect.value = state.clientSlug;
    }
  }

  function renderSidebarMonth() {
    els.heroBrandMonth.textContent = formatMonthLabel(state.month);
    els.navLinks.forEach(function (link) {
      const active = link.getAttribute("data-view") === state.activeView;
      link.classList.toggle("active", active);
    });
  }

  function renderViews() {
    destroyCharts();
    renderSidebarMonth();
    els.currentView.classList.toggle("active", state.activeView === "current");
    els.comparisonView.classList.toggle("active", state.activeView === "compare");
    try {
      renderCurrentView();
      renderComparisonView();
    } catch (error) {
      console.error(error);
      setStatus("The " + (state.activeView === "compare" ? "comparison" : "current") + " view could not be rendered. Please refresh and try again.", "error");
    }
  }

  function renderCurrentView() {
    if (!state.currentClient) {
      els.currentView.innerHTML = "";
      return;
    }

    const totals = getTotals(state.campaignRows);
    const comments = state.campaignRows.map(function (row) {
      return row.comments ? ((row.campaign_type || "Campaign") + ":\n" + row.comments) : "";
    }).filter(Boolean).join("\n\n");
    const todos = state.campaignRows.map(function (row) {
      return row.todos ? ((row.campaign_type || "Campaign") + ":\n" + row.todos) : "";
    }).filter(Boolean).join("\n\n");

    els.currentView.innerHTML = [
      '<div class="hero-card">',
      '<div class="eyebrow">Current Month Data</div>',
      '<div class="hero-title">' + escapeHtml(state.currentClient.name) + " · " + escapeHtml(formatMonthLabel(state.month)) + "</div>",
      '<div class="chip-row">',
      '<span class="chip active">' + escapeHtml(state.currentClient.status || "active") + "</span>",
      '<span class="chip">' + escapeHtml(formatNumber(state.campaignRows.length) + " campaigns") + "</span>",
      '</div></div>',

      sectionBlock("Benchmarks", renderBenchmarkBlock(totals)),
      sectionBlock("Campaign Breakdown", '<div class="campaign-grid">' + state.campaignRows.map(renderCampaignCard).join("") + "</div>"),
      sectionBlock("Performance Charts", '<div class="panel"><div class="chart-grid">' +
        chartCard("ROAS by campaign", "vs. 3x / 5x / 10x benchmarks", "chart-roas") +
        chartCard("Spend vs. attributed revenue", "Monthly campaign spend against attributed revenue.", "chart-revenue") +
        chartCard("Impressions vs. profile visits", "Reach efficiency by campaign.", "chart-traffic") +
        "</div></div>"),
      sectionBlock("Funnel Analysis", '<div class="panel"><div class="funnel-grid">' +
        renderFunnelCard("Top of funnel", "Awareness to engagement", [
          { label: "Impressions", value: totals.impressions, max: totals.impressions, color: "#bfdbfe" },
          { label: "Profile visits", value: totals.profileVisits, max: totals.impressions, color: "#bfdbfe" },
          { label: "Leads / Followers", value: totals.leadsFollowers, max: totals.impressions, color: "#86efac" },
          { label: "IG bio leads", value: totals.igBioLeads, max: totals.impressions, color: "#86efac" }
        ]) +
        renderFunnelCard("Bottom of funnel", "Lead capture to revenue", [
          { label: "Leads / Followers", value: totals.leadsFollowers, max: Math.max(totals.leadsFollowers, totals.bookingsEmail + totals.bookingsFb, 1), color: "#bbf7d0" },
          { label: "IG bio leads", value: totals.igBioLeads, max: Math.max(totals.leadsFollowers, totals.igBioLeads, 1), color: "#bbf7d0" },
          { label: "Email bookings", value: totals.bookingsEmail, max: Math.max(totals.bookingsEmail, totals.bookingsFb, totals.revenue, 1), color: "#fde68a" },
          { label: "FB bookings", value: totals.bookingsFb, max: Math.max(totals.bookingsEmail, totals.bookingsFb, totals.revenue, 1), color: "#fcd34d" },
          { label: "Revenue", value: totals.revenue, max: Math.max(totals.revenue, 1), color: "#86efac", format: "currency" }
        ]) +
        "</div></div>"),
      sectionBlock("All Metrics — Full Summary Table", '<div class="panel"><div class="table-wrap">' + renderCurrentTable() + "</div></div>"),
      sectionBlock("Notes", '<div class="panel"><div class="notes-grid">' +
        noteCard("Comments", comments || "No comments were stored for this month.") +
        noteCard("To-dos", todos || "No campaign to-dos were stored for this month.") +
        "</div></div>")
    ].join("");

    renderCurrentCharts();
  }

  function renderComparisonView() {
    if (!state.currentClient) {
      els.comparisonView.innerHTML = "";
      return;
    }

    const totals = getComparisonMonthTotals();
    const portfolioSection = safeComparisonSection(function () {
      return sectionBlock("Portfolio Snapshot — 3-Month Overview", '<div class="cmp-kpi-strip">' +
        renderComparisonKpi("Total ad spend", totals, "spend", "currency", true) +
        renderComparisonKpi("Attributed revenue", totals, "revenue", "currency", false) +
        renderComparisonKpi("Blended ROAS", totals, "blendedRoas", "multiple", false) +
        renderComparisonKpi("Total bookings tracked", totals, "bookings", "number", false) +
        '</div><div class="cmp-charts">' +
        cmpChartCard("Revenue vs. spend trend", "Monthly attributed revenue and total spend", "cmp-rev-spend") +
        cmpChartCard("Blended ROAS trend", "Month-over-month · benchmark lines shown", "cmp-roas-trend") +
        cmpChartCard("Total bookings tracked", "Email cross-match + FB events combined", "cmp-bookings") +
        '</div>');
    }, "Portfolio snapshot");
    const campaignSection = safeComparisonSection(function () {
      return renderComparisonCampaignSections();
    }, "Campaign comparison");
    const fullTableSection = safeComparisonSection(function () {
      return sectionBlock("Full 3-Month Metrics Comparison Table", '<div class="cmp-table-card"><div class="cmp-trend-wrap">' + renderComparisonFullTable() + "</div></div>");
    }, "Comparison table");
    const insightSection = safeComparisonSection(function () {
      return sectionBlock("3-Month Performance Insights", '<div class="cmp-insight-grid">' + renderComparisonInsights(totals) + "</div>");
    }, "Comparison insights");

    els.comparisonView.innerHTML = [
      '<div class="cmp-header">',
      '<div>',
      '<div class="eyebrow">Meta Ads · ROI Comparison</div>',
      '<div class="cmp-h-title">' + escapeHtml(state.currentClient.name) + "</div>",
      '<div class="cmp-h-sub">' + escapeHtml(state.comparisonMonths.map(function (item) { return item.label; }).join(" · ")) + " — all campaign types</div>",
      '</div>',
      '<div class="cmp-legend">' + state.comparisonMonths.map(function (item, index) {
        return '<div class="cmp-leg-item"><span class="cmp-leg-dot" style="background:' + monthPalette[index] + ';"></span>' + escapeHtml(item.label) + "</div>";
      }).join("") + "</div>",
      "</div>",
      portfolioSection,
      campaignSection,
      fullTableSection,
      insightSection
    ].join("");

    try {
      renderComparisonCharts();
    } catch (error) {
      console.error(error);
      setStatus("Comparison charts could not be rendered: " + (error.message || "Unknown error"), "error");
    }
  }

  function safeComparisonSection(fn, label) {
    try {
      return fn();
    } catch (error) {
      console.error(error);
      return '<div class="panel"><div class="note-body">' + escapeHtml(label + " could not be rendered: " + (error.message || "Unknown error")) + "</div></div>";
    }
  }

  function renderBenchmarkBlock(totals) {
    const items = [
      { label: "ROAS", value: formatMultiple(totals.blendedRoas), status: getPerformanceStatus("roas", totals.blendedRoas, false) },
      { label: "Cost / Visit", value: formatCurrency(totals.costPerVisit), status: getPerformanceStatus("costPerVisit", totals.costPerVisit, true) },
      { label: "Cost / Lead/Follower", value: formatCurrency(totals.costPerLeadFollower), status: getPerformanceStatus("costPerLeadFollower", totals.costPerLeadFollower, true) },
      { label: "% of Avg Booking Value", value: formatPercent(totals.percentOfBookingValue), status: getPerformanceStatus("percentOfBookingValue", totals.percentOfBookingValue, true) }
    ];

    return [
      '<div class="panel benchmark-block">',
      '<div class="benchmark-top">',
      '<div class="benchmark-title">Benchmarks:</div>',
      '<div class="benchmark-legend">',
      legendItem("Great", "var(--great)"),
      legendItem("Solid", "var(--solid)"),
      legendItem("Decent", "var(--decent)"),
      legendItem("Needs attention", "var(--warning)"),
      '</div></div>',
      '<div class="benchmark-metrics">' + items.map(function (item) {
        return '<span class="benchmark-item ' + escapeHtml(item.status.className) + '">' + escapeHtml(item.label + ": " + item.value + " · " + item.status.label) + "</span>";
      }).join("") + "</div>",
      '<div class="benchmark-bottom"><span>ROAS: >3x = Decent, >5x = Solid, >10x = Great</span><span>Cost/Visit: <$0.30 = Decent, <$0.20 = Solid, <$0.10 = Great</span><span>CPL/Follower: <$0.80 = Decent, <$0.50 = Solid, <$0.30 = Great</span><span>% of Avg Booking Value: <40% = Decent, <25% = Solid, <15% = Great</span></div>',
      "</div>"
    ].join("");
  }

  function renderCampaignCard(row) {
    const roasValue = getPrimaryRoasValue(row);
    const roasStatus = getPerformanceStatus("roas", roasValue, false);
    const costVisitStatus = getPerformanceStatus("costPerVisit", row.cost_per_visit, true);
    const leadStatus = getPerformanceStatus("costPerLeadFollower", row.cost_per_lead_follower, true);
    const bookingPercent = percentOfBookingValueFromRow(row);
    const bookingStatus = getPerformanceStatus("percentOfBookingValue", bookingPercent, true);
    const comment = row.comments || generateCampaignComment(row);

    return [
      '<article class="campaign-card hero-card">',
      '<div class="campaign-head">',
      '<div><h3>' + escapeHtml(row.campaign_type || "Campaign") + '</h3><p>Spend: ' + escapeHtml(formatCurrency(row.spend)) + "</p></div>",
      '<span class="status-pill ' + escapeHtml(roasStatus.className) + '">' + escapeHtml(roasStatus.label) + "</span>",
      '</div>',
      '<div class="metric-list">',
      metricCard("Revenue", formatCurrency(row.revenue)),
      metricCard(row.roas ? "ROAS" : "Blended ROAS", formatMultiple(roasValue), roasStatus.className),
      metricCard("Impressions", formatNumber(row.impressions)),
      metricCard("Profile visits", formatNumber(row.profile_visits)),
      metricCard("Cost / visit", formatCurrency(row.cost_per_visit), costVisitStatus.className),
      metricCard("Leads / followers", formatNumber(row.leads_followers)),
      metricCard("Cost / lead/follower", formatCurrency(row.cost_per_lead_follower), leadStatus.className),
      metricCard("IG bio leads", formatNumber(row.ig_bio_leads)),
      metricCard("Email bookings", formatNumber(row.bookings_email_matched)),
      metricCard("FB bookings", formatNumber(row.bookings_fb_events)),
      metricCard("Cost / booking", formatCurrency(row.cost_per_booking), bookingStatus.className),
      metricCard("% of booking value", formatPercent(bookingPercent), bookingStatus.className),
      '</div>',
      '<div class="campaign-comment">' + escapeHtml(comment) + "</div>",
      "</article>"
    ].join("");
  }

  function renderCurrentTable() {
    return [
      '<table class="metrics-table"><thead><tr>',
      '<th>Campaign</th><th>Spend</th><th>Impressions</th><th>Visits</th><th>Cost/Visit</th><th>Leads/Followers</th><th>Cost/<br>Leads/Followers</th><th>IG Bio Leads</th><th>Bookings (Email)</th><th>Bookings (FB)</th><th>Cost/Booking</th><th>Avg BV</th><th>% of BV</th><th>Revenue</th><th>ROAS</th><th>Blended ROAS</th>',
      '</tr></thead><tbody>',
      state.campaignRows.map(function (row) {
        const visitStatus = getPerformanceStatus("costPerVisit", row.cost_per_visit, true);
        const leadStatus = getPerformanceStatus("costPerLeadFollower", row.cost_per_lead_follower, true);
        const bookingPercent = percentOfBookingValueFromRow(row);
        const bookingStatus = getPerformanceStatus("percentOfBookingValue", bookingPercent, true);
        const roasStatus = getPerformanceStatus("roas", row.roas, false);
        const blendedStatus = getPerformanceStatus("roas", row.blended_roas, false);
        return [
          '<tr>',
          '<td>' + campaignChip(row.campaign_type) + '</td>',
          '<td>' + escapeHtml(formatCurrency(row.spend)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.impressions)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.profile_visits)) + '</td>',
          '<td>' + metricChip(formatCurrency(row.cost_per_visit), visitStatus.className) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.leads_followers)) + '</td>',
          '<td>' + metricChip(formatCurrency(row.cost_per_lead_follower), leadStatus.className) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.ig_bio_leads)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.bookings_email_matched)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.bookings_fb_events)) + '</td>',
          '<td>' + metricChip(formatCurrency(row.cost_per_booking), bookingStatus.className) + '</td>',
          '<td>' + escapeHtml(formatCurrency(row.avg_booking_value)) + '</td>',
          '<td>' + metricChip(formatPercent(bookingPercent), bookingStatus.className) + '</td>',
          '<td>' + escapeHtml(formatCurrency(row.revenue)) + '</td>',
          '<td>' + metricChip(formatMultiple(row.roas), roasStatus.className) + '</td>',
          '<td>' + metricChip(formatMultiple(row.blended_roas), blendedStatus.className) + '</td>',
          '</tr>'
        ].join("");
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderComparisonKpi(title, totals, field, type, inverseDelta) {
    return [
      '<div class="cmp-kpi">',
      '<div class="cmp-kpi-label">' + escapeHtml(title) + "</div>",
      '<div class="cmp-kpi-months">',
      totals.map(function (item, index) {
        const previousValue = index === 0 ? null : numeric(totals[index - 1][field]);
        const currentValue = numeric(item[field]);
        const delta = index === 0 ? null : percentDelta(previousValue, currentValue);
        return [
          index === 0 ? "" : '<div class="cmp-kpi-divider"></div>',
          '<div class="cmp-kpi-row"><span class="cmp-kpi-month" style="background:' + monthLightPalette[index] + ';color:' + monthPalette[index] + ';">' + escapeHtml(item.short) + '</span>',
          '<span class="cmp-kpi-val">' + escapeHtml(formatComparisonValue(item[field], type)) +
          (delta === null ? "" : '<span class="cmp-kpi-delta ' + deltaClass(delta, inverseDelta) + '">' + escapeHtml(formatDelta(delta)) + "</span>") +
          "</span></div>"
        ].join("");
      }).join(""),
      '</div></div>'
    ].join("");
  }

  function renderComparisonCampaignSections() {
    const grouped = groupComparisonByCampaign();
    const order = config.comparisonCampaignOrder || ["Retargeting", "Followers", "New Leads"];
    const campaigns = order.filter(function (name) { return grouped[name] && grouped[name].length; });
    return campaigns.map(function (campaign) {
      const rows = grouped[campaign].slice().sort(function (a, b) { return monthLookup(a).index - monthLookup(b).index; });
      return sectionBlock(campaign + " campaign — month-by-month",
        '<div class="cmp-campaign-table-card"><div class="cmp-campaign-table-wrap">' + renderComparisonCampaignTable(rows) + "</div></div>" +
        '<div class="cmp-charts" style="margin-top:16px">' + renderComparisonCampaignCharts(campaign) + "</div>"
      );
    }).join("");
  }

  function renderComparisonCampaignTable(rows) {
    return [
      '<table class="cmp-campaign-table"><thead><tr>',
      '<th>Month</th><th>Status</th><th>Spend</th><th>Revenue</th><th>ROAS</th><th>Impressions</th><th>Visits</th><th>Cost/Visit</th><th>Leads/Followers</th><th>Cost/Lead-Follower</th><th>IG Bio Leads</th><th>Bookings (Email)</th><th>Bookings (FB)</th><th>Cost/Booking</th><th>% of ABV</th><th>Comment</th>',
      '</tr></thead><tbody>',
      rows.map(function (row) {
        const lookup = monthLookup(row);
        const roasValue = getPrimaryRoasValue(row);
        const roasStatus = getPerformanceStatus("roas", roasValue, false);
        const visitStatus = getPerformanceStatus("costPerVisit", row.cost_per_visit, true);
        const leadStatus = getPerformanceStatus("costPerLeadFollower", row.cost_per_lead_follower, true);
        const bookingPercent = percentOfBookingValueFromRow(row);
        const bookingStatus = getPerformanceStatus("percentOfBookingValue", bookingPercent, true);
        return [
          '<tr>',
          '<td><span class="cmp-mp" style="background:' + rowMonthTheme(row).light + ';color:' + rowMonthTheme(row).color + ';">' + escapeHtml(lookup.short) + '</span></td>',
          '<td><span class="cmp-vp ' + comparisonValueClass(roasStatus.className) + '">' + escapeHtml(roasStatus.label) + '</span></td>',
          '<td>' + escapeHtml(formatCurrency(row.spend)) + '</td>',
          '<td>' + escapeHtml(formatCurrency(row.revenue)) + '</td>',
          '<td>' + comparisonValuePill(row.roas ? formatMultiple(row.roas) : "Blended " + formatMultiple(roasValue), roasStatus.className) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.impressions)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.profile_visits)) + '</td>',
          '<td>' + comparisonValuePill(formatCurrency(row.cost_per_visit), visitStatus.className) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.leads_followers)) + '</td>',
          '<td>' + comparisonValuePill(formatCurrency(row.cost_per_lead_follower), leadStatus.className) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.ig_bio_leads)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.bookings_email_matched)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.bookings_fb_events)) + '</td>',
          '<td>' + comparisonValuePill(formatCurrency(row.cost_per_booking), bookingStatus.className) + '</td>',
          '<td>' + comparisonValuePill(formatPercent(bookingPercent), bookingStatus.className) + '</td>',
          '<td class="cmp-campaign-note-cell">' + escapeHtml(row.comments || renderComparisonComment(row)) + '</td>',
          '</tr>'
        ].join("");
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderComparisonCampaignCharts(campaign) {
    if (campaign === "Retargeting") {
      return cmpChartCard("Retargeting ROAS trend", "Monthly · oldest to newest", "cmp-rt-roas") +
        cmpChartCard("FB event bookings", "Confirmed bookings via Facebook events", "cmp-rt-book") +
        cmpChartCard("Cost per booking (RT)", "Monthly trend · lower = better", "cmp-rt-cpb");
    }
    if (campaign === "Followers") {
      return cmpChartCard("Followers ROAS", state.comparisonMonths.map(function (item) { return item.label; }).join(" vs. "), "cmp-fol-roas") +
        cmpChartCard("Cost per follower", "vs. $0.30 great benchmark", "cmp-fol-cpf") +
        cmpChartCard("IG bio leads", "High-intent profile visitors", "cmp-fol-ig");
    }
    return cmpChartCard("New leads acquired", "Monthly cold lead volume", "cmp-nl-leads") +
      cmpChartCard("Cost per lead trend", "vs. $0.80 decent benchmark", "cmp-nl-cpl") +
      cmpChartCard("IG bio leads", "High-intent leads from IG profile", "cmp-nl-ig");
  }

  function renderComparisonFullTable() {
    return [
      '<table class="cmp-trend-table"><thead><tr>',
      '<th>Month</th><th>Campaign</th><th>Spend</th><th>Impressions</th><th>Visits</th><th>Cost/Visit</th><th>Leads/Followers</th><th>Cost/Lead-Follower</th><th>IG Bio Leads</th><th>Bookings (Email)</th><th>Bookings (FB)</th><th>Cost/Booking</th><th>% of ABV</th><th>Revenue</th><th>ROAS</th>',
      '</tr></thead><tbody>',
      state.comparisonRows.map(function (row) {
        const lookup = monthLookup(row);
        const roasValue = getPrimaryRoasValue(row);
        const visitStatus = getPerformanceStatus("costPerVisit", row.cost_per_visit, true);
        const leadStatus = getPerformanceStatus("costPerLeadFollower", row.cost_per_lead_follower, true);
        const bookingPercent = percentOfBookingValueFromRow(row);
        const bookingStatus = getPerformanceStatus("percentOfBookingValue", bookingPercent, true);
        const roasStatus = getPerformanceStatus("roas", roasValue, false);
        return [
          '<tr>',
          '<td><span class="cmp-mp" style="background:' + rowMonthTheme(row).light + ';color:' + rowMonthTheme(row).color + ';">' + escapeHtml(lookup.short) + '</span></td>',
          '<td>' + escapeHtml(row.campaign_type || "Campaign") + '</td>',
          '<td>' + escapeHtml(formatCurrency(row.spend)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.impressions)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.profile_visits)) + '</td>',
          '<td>' + comparisonValuePill(formatCurrency(row.cost_per_visit), visitStatus.className) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.leads_followers)) + '</td>',
          '<td>' + comparisonValuePill(formatCurrency(row.cost_per_lead_follower), leadStatus.className) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.ig_bio_leads)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.bookings_email_matched)) + '</td>',
          '<td>' + escapeHtml(formatNumber(row.bookings_fb_events)) + '</td>',
          '<td>' + comparisonValuePill(formatCurrency(row.cost_per_booking), bookingStatus.className) + '</td>',
          '<td>' + comparisonValuePill(formatPercent(bookingPercent), bookingStatus.className) + '</td>',
          '<td>' + escapeHtml(formatCurrency(row.revenue)) + '</td>',
          '<td>' + comparisonValuePill(row.roas ? formatMultiple(row.roas) : "Blended " + formatMultiple(roasValue), roasStatus.className) + '</td>',
          '</tr>'
        ].join("");
      }).join(""),
      '</tbody></table>'
    ].join("");
  }

  function renderComparisonInsights(totals) {
    if (!totals.length) {
      return "";
    }
    const first = totals[0];
    const last = totals[totals.length - 1];
    const revenueDelta = percentDelta(first.revenue, last.revenue);
    const spendDelta = percentDelta(first.spend, last.spend);
    const bookingsDelta = percentDelta(first.bookings, last.bookings);
    return [
      insightCard("Revenue trend", "Revenue moved " + formatDelta(revenueDelta) + " from " + first.short + " to " + last.short + ".", revenueDelta >= 0 ? "great" : "warn"),
      insightCard("Spend trend", "Ad spend moved " + formatDelta(spendDelta) + " across the same 3-month window.", spendDelta <= 0 ? "great" : "warn"),
      insightCard("Bookings trend", "Tracked bookings moved " + formatDelta(bookingsDelta) + " month over month.", bookingsDelta >= 0 ? "great" : "")
    ].join("");
  }

  function renderCurrentCharts() {
    const startIndex = state.charts.length;
    const labels = state.campaignRows.map(function (row) { return row.campaign_type || "Campaign"; });
    state.charts.push(makeChart("chart-roas", {
      chart: { type: "bar", height: 260, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
      series: [{ name: "ROAS", data: state.campaignRows.map(function (row) { return round2(getPrimaryRoasValue(row)); }) }],
      xaxis: { categories: labels, labels: { style: { fontSize: "11px", colors: "#475569" } } },
      yaxis: { labels: { formatter: function (v) { return round2(v) + "x"; }, style: { colors: "#64748b" } } },
      colors: ["#16a34a"],
      plotOptions: { bar: { borderRadius: 8, columnWidth: "52%" } },
      annotations: { yaxis: [benchmarkLine("Great 10×", 10, "#16a34a"), benchmarkLine("Solid 5×", 5, "#0f766e"), benchmarkLine("Decent 3×", 3, "#d97706")] },
      dataLabels: { enabled: true, formatter: function (v) { return round2(v) + "x"; }, style: { fontSize: "10px", fontWeight: 600 } }
    }));

    state.charts.push(makeChart("chart-revenue", {
      chart: { type: "bar", height: 260, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
      series: [
        { name: "Spend", data: state.campaignRows.map(function (row) { return numeric(row.spend); }) },
        { name: "Revenue", data: state.campaignRows.map(function (row) { return numeric(row.revenue); }) }
      ],
      xaxis: { categories: labels, labels: { style: { fontSize: "11px", colors: "#475569" } } },
      yaxis: { labels: { formatter: compactCurrency, style: { colors: "#64748b" } } },
      colors: ["#60a5fa", "#22c55e"],
      plotOptions: { bar: { borderRadius: 8, columnWidth: "50%" } },
      legend: { show: true, position: "bottom", fontSize: "11px" },
      dataLabels: { enabled: true, formatter: function (v) { return compactCurrency(v); }, style: { fontSize: "10px", fontWeight: 600 } }
    }));

    state.charts.push(makeChart("chart-traffic", {
      chart: { type: "bar", height: 260, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
      series: [
        { name: "Impressions", data: state.campaignRows.map(function (row) { return numeric(row.impressions); }) },
        { name: "Profile visits", data: state.campaignRows.map(function (row) { return numeric(row.profile_visits); }) }
      ],
      xaxis: { categories: labels, labels: { style: { fontSize: "11px", colors: "#475569" } } },
      yaxis: { labels: { formatter: compactNumber, style: { colors: "#64748b" } } },
      colors: ["#4f46e5", "#0f766e"],
      plotOptions: { bar: { borderRadius: 8, columnWidth: "50%" } },
      legend: { show: true, position: "bottom", fontSize: "11px" },
      dataLabels: { enabled: true, formatter: function (v) { return compactNumber(v); }, style: { fontSize: "10px", fontWeight: 600 } }
    }));

    renderChartBatch(startIndex);
  }

  function renderComparisonCharts() {
    const startIndex = state.charts.length;
    const totals = getComparisonMonthTotals();
    const labels = state.comparisonMonths.map(function (item) { return item.label; });

    state.charts.push(makeChart("cmp-rev-spend", {
      chart: { type: "bar", height: 240, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
      series: [
        { name: "Spend", data: totals.map(function (item) { return numeric(item.spend); }) },
        { name: "Revenue", data: totals.map(function (item) { return numeric(item.revenue); }) }
      ],
      xaxis: { categories: labels, labels: { style: { fontSize: "11px", colors: "#475569" } } },
      yaxis: { labels: { formatter: compactCurrency, style: { colors: "#64748b" } } },
      colors: ["#60a5fa", "#22c55e"],
      plotOptions: { bar: { borderRadius: 6, columnWidth: "56%" } },
      legend: { show: true, position: "bottom", fontSize: "11px" },
      dataLabels: { enabled: true, formatter: function (v) { return compactCurrency(v); }, style: { fontSize: "10px", fontWeight: 600 } }
    }));

    state.charts.push(makeChart("cmp-roas-trend", {
      chart: { type: "line", height: 240, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
      series: [{ name: "Blended ROAS", data: totals.map(function (item) { return round2(item.blendedRoas); }) }],
      xaxis: { categories: labels, labels: { style: { fontSize: "11px", colors: "#475569" }, offsetY: 10 } },
      yaxis: { labels: { formatter: function (v) { return round2(v) + "x"; }, style: { fontSize: "11px", colors: "#64748b" }, offsetX: -10 } },
      colors: ["#0f766e"],
      stroke: { width: 3, curve: "smooth" },
      markers: { size: 6, colors: ["#14b8a6"], strokeWidth: 3, strokeColors: "#ffffff" },
      grid: { padding: { top: 12, right: 14, bottom: 24, left: 24 } },
      annotations: { yaxis: [cmpLine("Great 10×", 10, "#16a34a", "#f0fdf4"), cmpLine("Solid 5×", 5, "#d97706", "#fffbeb")] },
      dataLabels: comparisonLineLabels(function (v) { return round2(v) + "x"; }, "#0f766e", "#99f6e4")
    }));

    state.charts.push(makeChart("cmp-bookings", {
      chart: { type: "bar", height: 240, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
      series: [{ name: "Bookings", data: totals.map(function (item) { return numeric(item.bookings); }) }],
      xaxis: { categories: labels, labels: { style: { fontSize: "11px", colors: "#475569" } } },
      yaxis: { labels: { style: { fontSize: "11px", colors: "#64748b" } } },
      colors: monthPalette,
      plotOptions: { bar: { borderRadius: 6, distributed: true, columnWidth: "52%" } },
      dataLabels: comparisonBarLabels()
    }));

    renderCampaignSpecificComparisonCharts();
    renderChartBatch(startIndex);
  }

  function renderCampaignSpecificComparisonCharts() {
    const retargeting = rowsForCampaign("Retargeting");
    if (retargeting.length) {
      state.charts.push(makeChart("cmp-rt-roas", buildLineChart(retargeting, function (row) { return round2(getPrimaryRoasValue(row)); }, function (v) { return round2(v) + "x"; }, "Great 10×", 10, "#0f766e", "#99f6e4", "#16a34a")));
      state.charts.push(makeChart("cmp-rt-book", buildBarChart(retargeting, function (row) { return numeric(row.bookings_fb_events); })));
      state.charts.push(makeChart("cmp-rt-cpb", buildLineChart(retargeting, function (row) { return round2(numeric(row.cost_per_booking)); }, formatCurrency, "", null, "#b45309", "#fde68a", null)));
    }

    const followers = rowsForCampaign("Followers");
    if (followers.length) {
      state.charts.push(makeChart("cmp-fol-roas", buildBarChart(followers, function (row) { return round2(getPrimaryRoasValue(row)); }, function (v) { return round2(v) + "x"; })));
      state.charts.push(makeChart("cmp-fol-cpf", buildBarChart(followers, function (row) { return round2(numeric(row.cost_per_lead_follower)); }, formatCurrency)));
      state.charts.push(makeChart("cmp-fol-ig", buildBarChart(followers, function (row) { return numeric(row.ig_bio_leads); })));
    }

    const newLeads = rowsForCampaign("New Leads");
    if (newLeads.length) {
      state.charts.push(makeChart("cmp-nl-leads", buildBarChart(newLeads, function (row) { return numeric(row.leads_followers); })));
      state.charts.push(makeChart("cmp-nl-cpl", buildLineChart(newLeads, function (row) { return round2(numeric(row.cost_per_lead_follower)); }, formatCurrency, "Decent $0.80", 0.8, "#0f766e", "#99f6e4", "#d97706")));
      state.charts.push(makeChart("cmp-nl-ig", buildBarChart(newLeads, function (row) { return numeric(row.ig_bio_leads); })));
    }
  }

  function buildBarChart(rows, valueGetter, formatter) {
    return {
      chart: { type: "bar", height: 200, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
      series: [{ name: "Value", data: rows.map(valueGetter) }],
      xaxis: { categories: rows.map(function (row) { return monthLookup(row).label; }), labels: { style: { fontSize: "11px", colors: "#475569" } } },
      yaxis: { labels: { formatter: formatter || compactNumber, style: { colors: "#64748b" } } },
      colors: rows.map(function (row) { return rowMonthTheme(row).color; }),
      plotOptions: { bar: { borderRadius: 6, distributed: true, columnWidth: "52%" } },
      dataLabels: comparisonBarLabels(formatter)
    };
  }

  function buildLineChart(rows, valueGetter, formatter, lineText, lineY, labelColor, borderColor, benchmarkColor) {
    const options = {
      chart: { type: "line", height: 200, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
      series: [{ name: "Value", data: rows.map(valueGetter) }],
      xaxis: { categories: rows.map(function (row) { return monthLookup(row).label; }), labels: { style: { fontSize: "11px", colors: "#475569" }, offsetY: 10 } },
      yaxis: { labels: { formatter: formatter, style: { fontSize: "11px", colors: "#64748b" }, offsetX: -10 } },
      colors: [labelColor],
      stroke: { width: 3, curve: "smooth" },
      markers: { size: 7, colors: [borderColor === "#fde68a" ? "#d97706" : "#14b8a6"], strokeWidth: 3, strokeColors: "#ffffff" },
      grid: { padding: { top: 12, right: 14, bottom: 22, left: 24 } },
      dataLabels: comparisonLineLabels(formatter, labelColor, borderColor)
    };
    if (lineText && lineY !== null) {
      options.annotations = { yaxis: [cmpLine(lineText, lineY, benchmarkColor || "#16a34a", benchmarkColor === "#d97706" ? "#fffbeb" : "#f0fdf4")] };
    }
    return options;
  }

  function renderAllCharts() {
    state.charts.forEach(function (chart) {
      if (chart && typeof chart.render === "function") {
        chart.render();
      }
    });
  }

  function renderChartBatch(startIndex) {
    state.charts.slice(startIndex).forEach(function (chart) {
      if (chart && typeof chart.render === "function") {
        chart.render();
      }
    });
  }

  function makeChart(id, options) {
    const target = document.getElementById(id);
    if (!target) {
      return null;
    }
    return new ApexCharts(target, Object.assign({
      grid: { borderColor: "#edf2f7", strokeDashArray: 3 },
      dataLabels: { enabled: false },
      legend: { show: false },
      tooltip: { theme: "light" }
    }, options));
  }

  function getTotals(rows) {
    const spend = sumRows(rows, "spend");
    const impressions = sumRows(rows, "impressions");
    const profileVisits = sumRows(rows, "profile_visits");
    const leadsFollowers = sumRows(rows, "leads_followers");
    const igBioLeads = sumRows(rows, "ig_bio_leads");
    const bookingsEmail = sumRows(rows, "bookings_email_matched");
    const bookingsFb = sumRows(rows, "bookings_fb_events");
    const revenue = sumRows(rows, "revenue");
    return {
      spend: spend,
      impressions: impressions,
      profileVisits: profileVisits,
      leadsFollowers: leadsFollowers,
      igBioLeads: igBioLeads,
      bookingsEmail: bookingsEmail,
      bookingsFb: bookingsFb,
      revenue: revenue,
      costPerVisit: profileVisits ? spend / profileVisits : 0,
      costPerLeadFollower: leadsFollowers ? spend / leadsFollowers : 0,
      avgBookingValue: averageRows(rows, "avg_booking_value"),
      costPerBooking: bookingsEmail + bookingsFb ? spend / (bookingsEmail + bookingsFb) : 0,
      percentOfBookingValue: averagePercentRows(rows, "pct_avg_booking_value"),
      blendedRoas: spend ? revenue / spend : 0
    };
  }

  function getComparisonMonthTotals() {
    return state.comparisonMonths.map(function (month) {
      const rows = state.comparisonRows.filter(function (row) {
        return Number(row.year) === month.year && Number(row.month) === month.month;
      });
      const totals = getTotals(rows);
      return {
        key: month.key,
        short: month.short,
        label: month.label,
        spend: totals.spend,
        revenue: totals.revenue,
        bookings: totals.bookingsEmail + totals.bookingsFb,
        blendedRoas: totals.blendedRoas
      };
    });
  }

  function groupComparisonByCampaign() {
    return state.comparisonRows.reduce(function (acc, row) {
      const key = row.campaign_type || "Campaign";
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(row);
      return acc;
    }, {});
  }

  function rowsForCampaign(campaign) {
    return state.comparisonRows.filter(function (row) { return row.campaign_type === campaign; }).sort(function (a, b) {
      return monthLookup(a).index - monthLookup(b).index;
    });
  }

  function getComparisonMonths(selectedMonth) {
    const parts = parseMonthKey(selectedMonth);
    const result = [];
    for (let offset = 2; offset >= 0; offset -= 1) {
      const date = new Date(parts.year, parts.month - 1 - offset, 1);
      result.push({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        key: date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0"),
        label: date.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
        short: date.toLocaleDateString(undefined, { month: "short" })
      });
    }
    return result;
  }

  function monthLookup(row) {
    const key = Number(row.year) + "-" + String(Number(row.month)).padStart(2, "0");
    const index = state.comparisonMonths.findIndex(function (item) { return item.key === key; });
    const date = new Date(Number(row.year), Number(row.month) - 1, 1);
    return {
      key: key,
      index: index,
      label: date.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      short: date.toLocaleDateString(undefined, { month: "short" })
    };
  }

  function rowMonthTheme(row) {
    const month = Number(row.month);
    if (month === 1) {
      return { color: "#7c3aed", light: "#f5f3ff" };
    }
    if (month === 2) {
      return { color: "#0891b2", light: "#ecfeff" };
    }
    return { color: "#16a34a", light: "#f0fdf4" };
  }

  function getPrimaryRoasValue(row) {
    if (!isMissing(row.roas) && numeric(row.roas) > 0) {
      return row.roas;
    }
    return row.blended_roas;
  }

  function percentOfBookingValueFromRow(row) {
    return normalizeStoredPercent(row && row.pct_avg_booking_value);
  }

  function normalizeStoredPercent(value) {
    if (isMissing(value)) { return 0; }
    const number = Number(value);
    if (!Number.isFinite(number)) { return 0; }
    return Math.abs(number) <= 1 ? number * 100 : number;
  }

  function averagePercentRows(rows, field) {
    const values = rows.map(function (row) { return normalizeStoredPercent(row[field]); }).filter(function (value) {
      return !isMissing(value) && Number.isFinite(value);
    });
    if (!values.length) { return 0; }
    return values.reduce(function (acc, value) { return acc + value; }, 0) / values.length;
  }

  function getPerformanceStatus(metricKey, value, lowerIsBetter) {
    const benchmark = benchmarks[metricKey];
    if (!benchmark || isMissing(value) || Number.isNaN(Number(value))) {
      return { label: "No Data", className: "building" };
    }
    const numericValue = Number(value);
    if (lowerIsBetter) {
      if (numericValue <= benchmark.great) { return { label: "Great", className: "great" }; }
      if (numericValue <= benchmark.solid) { return { label: "Solid", className: "solid" }; }
      if (numericValue <= benchmark.decent) { return { label: "Decent", className: "decent" }; }
      return { label: "Needs Attention", className: "warning" };
    }
    if (numericValue >= benchmark.great) { return { label: "Great", className: "great" }; }
    if (numericValue >= benchmark.solid) { return { label: "Solid", className: "solid" }; }
    if (numericValue >= benchmark.decent) { return { label: "Decent", className: "decent" }; }
    return { label: "Building", className: "building" };
  }

  function setLoading(loading) {
    els.loadButton.disabled = loading;
    els.refreshButton.disabled = loading;
    els.loadButton.textContent = loading ? "Loading..." : "Load Dashboard";
    els.refreshButton.textContent = loading ? "Refreshing..." : "Refresh Database";
  }

  function setStatus(message, type) {
    els.statusMessage.textContent = message;
    els.statusMessage.className = "status-message";
    if (!message) {
      return;
    }
    els.statusMessage.classList.add("show", type === "error" ? "error" : "info");
  }

  function updateRoute(month, client, view) {
    const params = new URLSearchParams(window.location.search);
    if (month) { params.set("month", month); }
    if (client) { params.set("client", client); } else { params.delete("client"); }
    if (view) { params.set("view", view); }
    const next = window.location.pathname + "?" + params.toString();
    window.history.replaceState({}, "", next);
  }

  function destroyCharts() {
    state.charts.forEach(function (chart) {
      if (chart && typeof chart.destroy === "function") {
        chart.destroy();
      }
    });
    state.charts = [];
  }

  function parseMonthKey(value) {
    const parts = String(value || "").split("-");
    return { year: Number(parts[0]), month: Number(parts[1]) };
  }

  function currentMonthKey() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  }

  function formatMonthLabel(value) {
    if (!value) { return "Current Month"; }
    const parts = parseMonthKey(value);
    return new Date(parts.year, parts.month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function sectionBlock(title, body) {
    return '<div class="section-block"><div class="section-kicker">' + escapeHtml(title) + "</div>" + body + "</div>";
  }

  function chartCard(title, subtitle, id) {
    return '<div class="chart-card hero-card"><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(subtitle) + '</p><div id="' + escapeHtml(id) + '"></div></div>';
  }

  function cmpChartCard(title, subtitle, id) {
    return '<div class="cmp-chart-card"><div class="cmp-chart-title">' + escapeHtml(title) + '</div><div class="cmp-chart-sub">' + escapeHtml(subtitle) + '</div><div id="' + escapeHtml(id) + '"></div></div>';
  }

  function noteCard(title, body) {
    return '<div class="note-card hero-card"><h3>' + escapeHtml(title) + '</h3><div class="note-body">' + escapeHtml(body) + "</div></div>";
  }

  function renderFunnelCard(title, subtitle, items) {
    return '<div class="funnel-card hero-card"><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(subtitle) + '</p>' + items.map(function (item) {
      const max = Math.max(numeric(item.max), 1);
      const width = Math.max((numeric(item.value) / max) * 100, 10);
      const text = item.format === "currency" ? formatCurrency(item.value) : formatNumber(item.value);
      return '<div class="funnel-row"><div class="funnel-label">' + escapeHtml(item.label) + '</div><div class="funnel-track"><div class="funnel-fill" style="width:' + width + '%;background:' + item.color + ';">' + escapeHtml(text) + '</div></div><div class="funnel-value">' + escapeHtml(text) + "</div></div>";
    }).join("") + "</div>";
  }

  function renderComparisonComment(row) {
    if (row.comments) {
      return row.comments;
    }
    const roasValue = getPrimaryRoasValue(row);
    if (row.campaign_type === "Retargeting") {
      return formatMultiple(roasValue) + " return with " + formatNumber(row.bookings_fb_events) + " tracked FB bookings.";
    }
    if (row.campaign_type === "Followers") {
      return formatMultiple(roasValue) + " ROAS with " + formatNumber(row.leads_followers) + " followers tracked.";
    }
    return formatNumber(row.leads_followers) + " leads captured at " + formatCurrency(row.cost_per_lead_follower) + " per lead.";
  }

  function generateCampaignComment(row) {
    return renderComparisonComment(row);
  }

  function metricCard(label, value, statusClass) {
    const color = statusTone(statusClass);
    const style = color ? ' style="color:' + color + ';"' : "";
    return '<div class="metric-item"><span>' + escapeHtml(label) + '</span><strong' + style + '>' + escapeHtml(value) + "</strong></div>";
  }

  function metricChip(value, className) {
    return '<span class="metric-chip ' + escapeHtml(className || "") + '">' + escapeHtml(value) + "</span>";
  }

  function campaignChip(value) {
    const label = value || "Campaign";
    const slug = String(label).toLowerCase().replace(/\s+/g, "-");
    return '<span class="campaign-chip ' + escapeHtml(slug) + '">' + escapeHtml(label) + "</span>";
  }

  function comparisonValuePill(value, className) {
    return '<span class="cmp-vp ' + escapeHtml(comparisonValueClass(className)) + '">' + escapeHtml(value) + "</span>";
  }

  function comparisonValueClass(statusClass) {
    return {
      great: "cmp-vp-gr",
      solid: "cmp-vp-sl",
      decent: "cmp-vp-dc",
      warning: "cmp-vp-wk",
      building: "cmp-vp-bl"
    }[statusClass] || "cmp-vp-bl";
  }

  function comparisonLineLabels(formatter, foreColor, borderColor) {
    return {
      enabled: true,
      formatter: formatter,
      offsetY: -18,
      offsetX: 10,
      style: { fontSize: "10px", fontWeight: 600 },
      background: {
        enabled: true,
        foreColor: foreColor,
        borderRadius: 6,
        padding: 4,
        opacity: 1,
        borderWidth: 1,
        borderColor: borderColor,
        backgroundColor: "#ffffff"
      }
    };
  }

  function comparisonBarLabels(formatter) {
    const config = {
      enabled: true,
      style: { fontSize: "10px", fontWeight: 600 }
    };
    if (typeof formatter === "function") {
      config.formatter = formatter;
    }
    return config;
  }

  function benchmarkLine(text, y, color) {
    return {
      y: y,
      borderColor: color,
      label: { text: text, style: { background: "#ffffff", color: color, fontSize: "10px", fontWeight: 700 } }
    };
  }

  function cmpLine(text, y, color, bg) {
    return {
      y: y,
      borderColor: color,
      label: { text: text, style: { fontSize: "9px", color: color, background: bg } }
    };
  }

  function legendItem(label, color) {
    return '<span><span class="benchmark-dot" style="background:' + color + ';"></span>' + escapeHtml(label) + "</span>";
  }

  function insightCard(title, body, className) {
    return '<div class="cmp-insight-card ' + escapeHtml(className || "") + '"><div class="cmp-ic-title">' + escapeHtml(title) + '</div><div class="cmp-ic-body">' + escapeHtml(body) + "</div></div>";
  }

  function comparisonBadgeClass(statusClass) {
    return statusClass || "building";
  }

  function renderComparisonValue(value, type) {
    if (type === "currency") { return formatCurrency(value); }
    if (type === "multiple") { return formatMultiple(value); }
    if (type === "number") { return formatNumber(value); }
    return formatPercent(value);
  }

  function formatComparisonValue(value, type) {
    return renderComparisonValue(value, type);
  }

  function formatCurrency(value) {
    if (isMissing(value)) { return "N/A"; }
    return "$" + new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(round2(value));
  }

  function formatNumber(value) {
    if (isMissing(value)) { return "N/A"; }
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(numeric(value)));
  }

  function formatPercent(value) {
    if (isMissing(value)) { return "N/A"; }
    return round2(value) + "%";
  }

  function formatMultiple(value) {
    if (isMissing(value)) { return "N/A"; }
    return round2(value) + "x";
  }

  function compactCurrency(value) {
    if (Math.abs(value) >= 1000) {
      return "$" + Math.round(value / 1000) + "K";
    }
    return formatCurrency(value);
  }

  function compactNumber(value) {
    if (Math.abs(value) >= 1000) {
      return Math.round(value / 1000) + "K";
    }
    return formatNumber(value);
  }

  function formatDelta(value) {
    const prefix = value > 0 ? "+" : "";
    return prefix + round2(value) + "%";
  }

  function deltaClass(delta, inverse) {
    if (Math.abs(delta) < 0.01) { return "cmp-d-flat"; }
    if (inverse) { return delta > 0 ? "cmp-d-down" : "cmp-d-up"; }
    return delta > 0 ? "cmp-d-up" : "cmp-d-down";
  }

  function percentDelta(base, value) {
    if (!base) { return 0; }
    return ((value - base) / base) * 100;
  }

  function numeric(value) {
    if (isMissing(value)) { return 0; }
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function isMissing(value) {
    return value === null || value === undefined || value === "";
  }

  function round2(value) {
    return Number(numeric(value).toFixed(2));
  }

  function sumRows(rows, field) {
    return rows.reduce(function (acc, row) {
      return acc + numeric(row[field]);
    }, 0);
  }

  function averageRows(rows, field) {
    const values = rows.map(function (row) { return numeric(row[field]); }).filter(Boolean);
    if (!values.length) { return 0; }
    return values.reduce(function (acc, value) { return acc + value; }, 0) / values.length;
  }

  function sortCampaignRows(rows) {
    const order = config.campaignOrder || [];
    return rows.slice().sort(function (a, b) {
      const aIndex = order.indexOf(a.campaign_type);
      const bIndex = order.indexOf(b.campaign_type);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
  }

  function sortComparisonRows(rows) {
    const order = config.campaignOrder || [];
    return rows.slice().sort(function (a, b) {
      const monthDiff = Number(a.year) - Number(b.year) || Number(a.month) - Number(b.month);
      if (monthDiff !== 0) { return monthDiff; }
      const aIndex = order.indexOf(a.campaign_type);
      const bIndex = order.indexOf(b.campaign_type);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
  }

  function statusTone(statusClass) {
    return {
      great: "#16a34a",
      solid: "#059669",
      decent: "#b45309",
      warning: "#dc2626",
      building: "#7e8798"
    }[statusClass] || "";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  init();
})();
