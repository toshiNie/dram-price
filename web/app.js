const DATA_PATHS = [
  { prices: 'data/prices.json', series: 'data/series.json', status: 'data/status.json' },
  { prices: '../data/prices.json', series: '../data/series.json', status: '../data/status.json' },
];
const THEME_STORAGE_KEY = 'dram-price-theme';
const COLORS = ['#3182f6', '#00a886', '#e03131', '#b76e00', '#7c3aed', '#0891b2', '#65a30d', '#db2777', '#2563eb', '#dc2626'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const KIND_LABELS = {
  contract: '合约价',
  spot: '现货价',
  spot_proxy: '现货代理',
};
const SOURCE_LABELS = {
  memorymarket: 'MemoryMarket',
  trendforce: 'TrendForce',
};
const METRIC_LABELS = {
  auto: '自动选择',
  session_average: '会话均价',
  average: '均价',
  daily_high: '高价',
  daily_low: '低价',
};
const CAVEAT_LABELS = {
  'TrendForce/DRAMeXchange public pages expose current tables but not free historical data.': 'TrendForce/DRAMeXchange 公开页面主要提供当前价格表，免费历史数据有限。',
  'MemoryMarket publicly discloses six-month weekly history; respect source terms and attribution.': 'MemoryMarket 公开约六个月的周度历史，请遵守来源条款并注明出处。',
  'Contract prices are monthly/update-date observations; collected_at is not the effective price date.': '合约价按月度或更新时间记录，采集时间并不等于价格生效日期。',
};
const KNOWN_METRIC_VALUE_KEYS = new Set(['average', 'daily_high', 'daily_low', 'high', 'low', 'session_average', 'session_high', 'session_low']);

const state = { prices: [], series: [], status: null };

function storedTheme() {
  try {
    return window.localStorage?.getItem(THEME_STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

function saveTheme(theme) {
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch (_) {
    // Theme persistence is optional; the static dashboard still works without localStorage.
  }
}

function currentTheme() {
  return document.documentElement?.dataset?.theme || 'light';
}

function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = normalized;
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  const isDark = normalized === 'dark';
  button.setAttribute('aria-pressed', String(isDark));
  button.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
  const label = button.querySelector('.theme-toggle-text');
  if (label) label.textContent = isDark ? '浅色模式' : '深色模式';
}

function bindThemeToggle() {
  applyTheme(storedTheme() || 'light');
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  button.addEventListener('click', () => {
    const nextTheme = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    saveTheme(nextTheme);
  });
}

function enableTableDrag() {
  document.querySelectorAll('.table-wrap').forEach((wrap) => {
    if (wrap.dataset.dragScrollBound === 'true') return;
    wrap.dataset.dragScrollBound = 'true';
    if (!wrap.getAttribute('tabindex')) wrap.setAttribute('tabindex', '0');
    if (!wrap.getAttribute('aria-label')) wrap.setAttribute('aria-label', '在表格内滚动查看全部行和列');
    const drag = { active: false, startX: 0, startScrollLeft: 0 };
    wrap.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || wrap.scrollWidth <= wrap.clientWidth) return;
      if (event.target && event.target.closest && event.target.closest('a, button, input, select, textarea, summary')) return;
      drag.active = true;
      drag.startX = event.clientX;
      drag.startScrollLeft = wrap.scrollLeft;
      wrap.classList.add('is-dragging');
      if (wrap.setPointerCapture) wrap.setPointerCapture(event.pointerId);
    });
    wrap.addEventListener('pointermove', (event) => {
      if (!drag.active) return;
      wrap.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startX);
    });
    const stopDrag = (event) => {
      if (!drag.active) return;
      drag.active = false;
      wrap.classList.remove('is-dragging');
      if (wrap.releasePointerCapture) wrap.releasePointerCapture(event.pointerId);
    };
    wrap.addEventListener('pointerup', stopDrag);
    wrap.addEventListener('pointercancel', stopDrag);
    wrap.addEventListener('mouseleave', () => {
      drag.active = false;
      wrap.classList.remove('is-dragging');
    });
    wrap.addEventListener('keydown', (event) => {
      const lineStep = 64;
      const pageStep = Math.max(160, wrap.clientHeight * 0.8);
      let handled = true;
      if (event.key === 'ArrowRight') wrap.scrollLeft += lineStep;
      else if (event.key === 'ArrowLeft') wrap.scrollLeft -= lineStep;
      else if (event.key === 'ArrowDown' && wrap.scrollHeight > wrap.clientHeight) wrap.scrollTop += lineStep;
      else if (event.key === 'ArrowUp' && wrap.scrollHeight > wrap.clientHeight) wrap.scrollTop -= lineStep;
      else if (event.key === 'PageDown' && wrap.scrollHeight > wrap.clientHeight) wrap.scrollTop += pageStep;
      else if (event.key === 'PageUp' && wrap.scrollHeight > wrap.clientHeight) wrap.scrollTop -= pageStep;
      else handled = false;
      if (handled) event.preventDefault();
    });
  });
}

async function loadJsonFallback(kind) {
  const errors = [];
  for (const paths of DATA_PATHS) {
    try {
      const response = await fetch(paths[kind], { cache: 'no-store' });
      if (response.ok) return response.json();
      errors.push(`${paths[kind]}: ${response.status}`);
    } catch (error) {
      errors.push(`${paths[kind]}: ${error.message}`);
    }
  }
  throw new Error(errors.join('; '));
}

function metricFor(obs, requested) {
  const values = obs.values || {};
  if (requested === 'daily_high') return values.daily_high ?? values.high ?? values.session_high;
  if (requested === 'daily_low') return values.daily_low ?? values.low ?? values.session_low;
  if (requested === 'session_average') return values.session_average ?? values.average;
  if (requested === 'average') return values.average ?? values.session_average;
  if (requested !== 'auto' && Object.hasOwn(values, requested)) return values[requested];
  return values.session_average ?? values.average ?? values.daily_high ?? values.high ?? values.session_high;
}

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, options = {}) {
  return Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 3, ...options }) : '无数据';
}

function formatAxisNumber(value, step = 1) {
  if (!Number.isFinite(value)) return '无数据';
  const maximumFractionDigits = Math.abs(step) >= 1 ? 0 : Math.min(3, Math.max(1, Math.ceil(-Math.log10(Math.abs(step))) + 1));
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits });
}

function buildCleanAxisTicks(min, max, preferredCount = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [], step: 1 };
  let safeMin = Math.min(min, max);
  let safeMax = Math.max(min, max);
  if (safeMin === safeMax) {
    const pad = Math.max(1, Math.abs(safeMax) * 0.08);
    safeMin -= pad;
    safeMax += pad;
  }
  const range = Math.max(safeMax - safeMin, Number.EPSILON);
  let step = niceAxisStep(range / Math.max(1, preferredCount - 1));
  if (Math.max(Math.abs(safeMin), Math.abs(safeMax)) >= 2 && range >= preferredCount - 1) {
    step = Math.max(1, step);
  }
  const start = safeMin >= 0 && safeMin < step ? 0 : Math.floor(safeMin / step) * step;
  const end = Math.ceil(safeMax / step) * step;
  const ticks = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toFixed(8)));
  }
  return { ticks, step };
}

function niceAxisStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const fraction = rawStep / (10 ** exponent);
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * (10 ** exponent);
}

function formatDateTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function observationCategory(obs) {
  return obs.category || 'uncategorized';
}

function seriesCategories(item) {
  return item.categories?.length ? item.categories : [item.category || 'uncategorized'];
}

function categoryLabel(category) {
  return category === 'uncategorized' ? '其他' : category.toUpperCase();
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || String(kind || '未知').replace('_', ' ');
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || '未知';
}

function primarySourceUrl(source) {
  const match = (state.status?.sources || []).find((item) => item.source === source);
  if (match?.urls?.length) return match.urls[0];
  return null;
}

function sourceLink(source, url) {
  const href = url || primarySourceUrl(source);
  const label = sourceLabel(source);
  if (!href) return document.createTextNode(label);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.className = 'source-link';
  anchor.textContent = label;
  anchor.setAttribute('aria-label', `${label} 打开原始来源`);
  return anchor;
}

function metricLabel(metric) {
  return METRIC_LABELS[metric] || metric.replaceAll('_', ' ');
}

function caveatLabel(text) {
  return CAVEAT_LABELS[text] || text;
}

function createElement(name, className) {
  const element = document.createElement(name);
  if (className) element.className = className;
  return element;
}

function appendOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function appendStatusLine(parent, label, value) {
  const row = createElement('div', 'status-line');
  const labelElement = createElement('span', 'status-label');
  const valueElement = createElement('span', 'status-value');
  labelElement.textContent = label;
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  parent.append(row);
}

function appendInfoItem(parent, title, detail, className = 'mini-item') {
  const item = createElement('div', className);
  const strong = document.createElement('strong');
  const small = document.createElement('small');
  if (title instanceof Node) strong.append(title);
  else strong.textContent = title;
  small.textContent = detail;
  item.append(strong, small);
  parent.append(item);
}

function replaceOptions(select, options, preferredValue) {
  select.replaceChildren();
  options.forEach((option) => appendOption(select, option.value, option.label));
  const values = new Set(options.map((option) => option.value));
  select.value = values.has(preferredValue) ? preferredValue : options[0]?.value || '';
}

function filterRows({ source = 'all', kind = 'all', category = 'all', product = 'all' } = {}) {
  let rows = state.prices.slice();
  if (source !== 'all') rows = rows.filter((obs) => obs.source === source);
  if (kind !== 'all') rows = rows.filter((obs) => obs.kind === kind);
  if (category !== 'all') rows = rows.filter((obs) => observationCategory(obs) === category);
  if (product !== 'all' && product !== 'representative') rows = rows.filter((obs) => obs.product_id === product);
  return rows;
}

function matchingRepresentativeIds({ source = 'all', kind = 'all', category = 'all' } = {}) {
  const productIds = new Set(filterRows({ source, kind, category }).map((obs) => obs.product_id));
  return new Set(
    state.series
      .filter((item) => item.representative)
      .filter((item) => productIds.has(item.product_id))
      .map((item) => item.product_id),
  );
}

function productOptionLabel(item) {
  const categories = seriesCategories(item).map(categoryLabel).join(', ');
  return `${item.representative ? '★ ' : ''}${item.product_name} (${sourceLabel(item.source)} · ${categories})`;
}

function productOptionsFor(rows, context) {
  const productIds = new Set(rows.map((obs) => obs.product_id));
  const representatives = matchingRepresentativeIds(context);
  const options = [];
  if (representatives.size) options.push({ value: 'representative', label: '优先显示代表产品' });
  options.push({ value: 'all', label: '全部产品' });
  state.series
    .filter((item) => productIds.has(item.product_id))
    .forEach((item) => options.push({ value: item.product_id, label: productOptionLabel(item) }));
  return options;
}

function rowsForProductSelection({ source = 'all', kind = 'all', category = 'all', product = 'all' } = {}) {
  let rows = filterRows({ source, kind, category });
  if (product === 'representative') {
    const reps = matchingRepresentativeIds({ source, kind, category });
    rows = rows.filter((obs) => reps.has(obs.product_id));
  } else if (product !== 'all') {
    rows = rows.filter((obs) => obs.product_id === product);
  }
  return rows;
}

function hasMetric(obs, metric) {
  const values = obs.values || {};
  if (metric === 'auto') return true;
  if (metric === 'daily_high') return asFiniteNumber(values.daily_high ?? values.high ?? values.session_high) !== null;
  if (metric === 'daily_low') return asFiniteNumber(values.daily_low ?? values.low ?? values.session_low) !== null;
  if (metric === 'session_average') return asFiniteNumber(values.session_average) !== null;
  if (metric === 'average') return asFiniteNumber(values.average) !== null;
  return asFiniteNumber(values[metric]) !== null;
}

function metricOptionsFor(rows) {
  const knownOptions = Object.keys(METRIC_LABELS)
    .filter((metric) => metric === 'auto' || rows.some((obs) => hasMetric(obs, metric)))
    .map((metric) => ({ value: metric, label: metricLabel(metric) }));
  const dynamicMetrics = uniqueSorted(
    rows.flatMap((obs) =>
      Object.entries(obs.values || {})
        .filter(([key, value]) => !KNOWN_METRIC_VALUE_KEYS.has(key) && !key.endsWith('_change_percent') && asFiniteNumber(value) !== null)
        .map(([key]) => key),
    ),
  );
  return [...knownOptions, ...dynamicMetrics.map((metric) => ({ value: metric, label: metricLabel(metric) }))];
}

function refreshFilterOptions() {
  const sourceFilter = document.getElementById('source-filter');
  const kindFilter = document.getElementById('kind-filter');
  const categoryFilter = document.getElementById('category-filter');
  const productFilter = document.getElementById('product-filter');
  const metricFilter = document.getElementById('metric-filter');

  replaceOptions(
    sourceFilter,
    [{ value: 'all', label: '全部来源' }, ...uniqueSorted(state.prices.map((obs) => obs.source)).map((source) => ({ value: source, label: sourceLabel(source) }))],
    sourceFilter.value || 'all',
  );

  const source = sourceFilter.value;
  const rowsBySource = filterRows({ source });
  replaceOptions(
    kindFilter,
    [{ value: 'all', label: '全部' }, ...uniqueSorted(rowsBySource.map((obs) => obs.kind)).map((kind) => ({ value: kind, label: kindLabel(kind) }))],
    kindFilter.value || 'all',
  );

  const kind = kindFilter.value;
  const rowsByKind = filterRows({ source, kind });
  replaceOptions(
    categoryFilter,
    [{ value: 'all', label: '全部类别' }, ...uniqueSorted(rowsByKind.map(observationCategory)).map((category) => ({ value: category, label: categoryLabel(category) }))],
    categoryFilter.value || 'all',
  );

  const category = categoryFilter.value;
  const rowsByCategory = filterRows({ source, kind, category });
  replaceOptions(productFilter, productOptionsFor(rowsByCategory, { source, kind, category }), productFilter.value || 'representative');

  const product = productFilter.value;
  replaceOptions(metricFilter, metricOptionsFor(rowsForProductSelection({ source, kind, category, product })), metricFilter.value || 'auto');
}

function populateFilters() {
  refreshFilterOptions();
  document.querySelectorAll('select').forEach((select) => select.addEventListener('change', render));
}

function selectedObservations() {
  const source = document.getElementById('source-filter').value;
  const kind = document.getElementById('kind-filter').value;
  const category = document.getElementById('category-filter').value;
  const product = document.getElementById('product-filter').value;
  return rowsForProductSelection({ source, kind, category, product });
}

function renderHeroStatus() {
  const card = document.getElementById('run-status');
  card.replaceChildren();
  const okSources = state.status?.sources?.filter((source) => source.ok).length || 0;
  const totalSources = state.status?.sources?.length || 0;
  appendStatusLine(card, '最近采集', formatDateTime(state.status?.generated_at));
  appendStatusLine(card, '观测总数', `${formatNumber(state.status?.observation_count ?? state.prices.length)}条`);
  appendStatusLine(card, '来源状态', `${okSources}/${totalSources} 正常`);
  appendStatusLine(card, '部署方式', 'GitHub Pages 静态仪表盘');
}

function renderSummaryCards() {
  const countsByKind = state.status?.counts_by_kind || {};
  const spotCount = (countsByKind.spot || 0) + (countsByKind.spot_proxy || 0);
  const contractCount = countsByKind.contract || 0;
  const representativeCount = state.series.filter((item) => item.representative).length;
  const categoryCount = uniqueSorted(state.series.flatMap(seriesCategories)).length;

  setText('summary-observations', `${formatNumber(state.status?.observation_count ?? state.prices.length)}条`);
  setText('summary-observations-detail', `${state.series.length}个产品/系列中的标准化记录。`);
  setText('summary-representatives', `${representativeCount}条`);
  setText('summary-representatives-detail', `${categoryCount}个类别的核心产品显示在默认图表中。`);
  setText('summary-spot', `${formatNumber(spotCount)}条`);
  setText('summary-contract', `${formatNumber(contractCount)}条`);
  setText('summary-generated', formatDateTime(state.status?.generated_at));
  setText('summary-generated-detail', '显示时间以中国标准时间为准。');
}

function renderStatus() {
  renderHeroStatus();
  renderSummaryCards();

  const sourceStatus = document.getElementById('source-status');
  sourceStatus.replaceChildren();
  (state.status?.sources || []).forEach((source) => {
    const warnings = [...(source.warnings || []), ...(source.errors || [])];
    const className = source.ok ? 'gate-item pass' : source.errors?.length ? 'gate-item fail' : 'gate-item block';
    const detail = `${formatNumber(source.observation_count || 0)}条观测${warnings.length ? ` · ${warnings.join('; ')}` : ' · 无警告'}`;
    const title = document.createDocumentFragment();
    title.append(sourceLink(source.source, source.urls?.[0]), document.createTextNode(` · ${source.ok ? '正常' : '需要检查'}`));
    appendInfoItem(sourceStatus, title, detail, className);
  });

  const caveats = document.getElementById('source-caveats');
  caveats.replaceChildren();
  (state.status?.caveats || []).forEach((caveat, idx) => appendInfoItem(caveats, `注意 ${idx + 1}`, caveatLabel(caveat)));
}

function groupSeries(rows, requestedMetric) {
  const groups = new Map();
  rows.forEach((obs) => {
    const value = asFiniteNumber(metricFor(obs, requestedMetric));
    if (value === null) return;
    const key = `${obs.product_id}|${obs.kind}`;
    if (!groups.has(key)) groups.set(key, { label: `${obs.product_name} · ${kindLabel(obs.kind)}`, points: [] });
    groups.get(key).points.push({ date: String(obs.date || ''), value });
  });
  return [...groups.values()]
    .map((group) => ({ ...group, points: group.points.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function appendSvgText(parent, text, attributes) {
  const element = createSvgElement('text', attributes);
  element.textContent = text;
  parent.append(element);
}

function dateRangeLabel(rows) {
  const dates = uniqueSorted(rows.map((obs) => obs.date));
  if (!dates.length) return '无日期';
  if (dates.length === 1) return dates[0];
  return `${dates[0]} ~ ${dates[dates.length - 1]}`;
}

function sourceBucketsForRows(rows) {
  const seen = new Set(rows.map((obs) => obs.source || '未知'));
  const configuredSources = (state.status?.sources || []).map((source) => source.source).filter(Boolean);
  const orderedSources = [
    ...configuredSources.filter((source) => seen.has(source)),
    ...uniqueSorted([...seen].filter((source) => !configuredSources.includes(source))),
  ];
  return orderedSources.map((source) => ({
    source,
    rows: rows.filter((obs) => (obs.source || '未知') === source),
  }));
}

function renderFilterSummary(rows, sourceCharts, metric, limitValue) {
  const source = document.getElementById('source-filter').value;
  const kind = document.getElementById('kind-filter').value;
  const category = document.getElementById('category-filter').value;
  const product = document.getElementById('product-filter').value;
  const displayedGroups = sourceCharts.reduce((total, chart) => total + chart.groups.length, 0);
  const totalGroups = sourceCharts.reduce((total, chart) => total + chart.allGroups.length, 0);
  const nonEmptySources = sourceCharts.filter((chart) => chart.allGroups.length).length;
  const filters = [
    source === 'all' ? '全部来源' : sourceLabel(source),
    kind === 'all' ? '全部价格类型' : kindLabel(kind),
    category === 'all' ? '全部类别' : categoryLabel(category),
    product === 'representative' ? '代表产品' : product === 'all' ? '全部产品' : '所选产品',
  ];
  const limitNote = limitValue === 'all' ? '不限制系列数量' : `各来源最多 ${limitValue}个系列`;
  setText('filter-summary', `${filters.join(' · ')} · ${formatNumber(rows.length)}条观测 · ${dateRangeLabel(rows)} · ${metricLabel(metric)} · ${limitNote}`);
  setText('chart-subtitle', `${nonEmptySources}个来源图表 · ${displayedGroups}个系列 / 全部匹配系列 ${totalGroups}个系列`);
}

function createPointValueLabels(points, x, y, topY, bottomY, rightX) {
  const layer = createSvgElement('g', { class: 'series-value-layer' });
  points.forEach((point, index) => {
    const valueText = formatNumber(point.value);
    const pointX = x(point.date);
    const pointY = y(point.value);
    const labelWidth = Math.min(96, Math.max(48, valueText.length * 7.2 + 18));
    const labelHeight = 21;
    const lane = (index % 3) - 1;
    let labelX = pointX + 12;
    if (labelX + labelWidth > rightX) labelX = pointX - labelWidth - 12;
    labelX = Math.max(8, Math.min(labelX, rightX - labelWidth));
    let labelY = pointY - 14 + lane * 18;
    labelY = Math.max(topY + 16, Math.min(labelY, bottomY - 8));

    const label = createSvgElement('g', {
      class: 'series-value-label',
      transform: `translate(${labelX.toFixed(1)} ${labelY.toFixed(1)})`,
    });
    label.append(
      createSvgElement('rect', {
        class: 'series-value-pill',
        x: 0,
        y: -labelHeight + 5,
        width: labelWidth.toFixed(1),
        height: labelHeight,
        rx: 10.5,
      }),
    );
    appendSvgText(label, valueText, {
      x: 8,
      y: -5,
      'dominant-baseline': 'middle',
      'text-anchor': 'start',
    });
    layer.append(label);
  });
  return layer;
}

function createChartSvg(groups) {
  const allPoints = groups.flatMap((group) => group.points);
  const dates = uniqueSorted(allPoints.map((point) => point.date));
  const values = allPoints.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const axis = buildCleanAxisTicks(min, max, 5);
  const yTicks = axis.ticks.length >= 2 ? axis.ticks : [min, max];
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const width = 1040;
  const height = 390;
  const left = 78;
  const right = 28;
  const top = 24;
  const bottom = 62;
  const x = (date) => left + (dates.indexOf(date) / Math.max(1, dates.length - 1)) * (width - left - right);
  const y = (value) => top + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * (height - top - bottom);

  const svg = createSvgElement('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMidYMid meet' });
  yTicks.forEach((value) => {
    svg.append(createSvgElement('line', { class: 'grid', x1: left, x2: width - right, y1: y(value), y2: y(value) }));
    appendSvgText(svg, formatAxisNumber(value, axis.step), { x: 16, y: y(value) + 4, 'font-size': 13, 'font-weight': 650, fill: '#aab3c2' });
  });
  svg.append(createSvgElement('line', { class: 'axis', x1: left, x2: width - right, y1: height - bottom, y2: height - bottom }));
  svg.append(createSvgElement('line', { class: 'axis', x1: left, x2: left, y1: top, y2: height - bottom }));

  const minDateLabelGap = 140;
  const maxTickCount = Math.max(5, Math.floor((width - left - right) / minDateLabelGap) + 1);
  const tickCount = Math.min(maxTickCount, dates.length);
  const tickIndexes = [...new Set(
    Array.from({ length: tickCount }, (_, idx) => Math.round((idx / Math.max(1, tickCount - 1)) * (dates.length - 1))),
  )];
  tickIndexes.forEach((dateIdx) => {
    const date = dates[dateIdx];
    const xPos = x(date);
    const textAnchor = dateIdx === 0 ? 'start' : dateIdx === dates.length - 1 ? 'end' : 'middle';
    appendSvgText(svg, date, { x: xPos, y: height - 22, 'text-anchor': textAnchor, 'font-size': 13, 'font-weight': 650, fill: '#aab3c2' });
  });

  groups.forEach((group, idx) => {
    const color = COLORS[idx % COLORS.length];
    const d = group.points.map((point, pointIdx) => `${pointIdx ? 'L' : 'M'} ${x(point.date).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
    const seriesGroup = createSvgElement('g', {
      class: 'chart-series',
      tabindex: 0,
      focusable: true,
      role: 'img',
      'aria-label': `${group.label} 日内价格走势`,
    });
    seriesGroup.style.setProperty('--series-color', color);
    const activateSeries = () => seriesGroup.classList.add('is-active');
    const deactivateSeries = (event) => {
      if (event?.relatedTarget && seriesGroup.contains(event.relatedTarget)) return;
      seriesGroup.classList.remove('is-active');
    };
    seriesGroup.addEventListener('pointerenter', activateSeries);
    seriesGroup.addEventListener('pointerover', activateSeries);
    seriesGroup.addEventListener('mousemove', activateSeries);
    seriesGroup.addEventListener('pointerleave', deactivateSeries);
    seriesGroup.addEventListener('pointerout', deactivateSeries);
    seriesGroup.addEventListener('click', activateSeries);
    seriesGroup.addEventListener('focus', activateSeries);
    seriesGroup.addEventListener('blur', deactivateSeries);
    seriesGroup.append(
      createSvgElement('path', { class: 'series-hit-line', d, stroke: color }),
      createSvgElement('path', { class: 'series series-line', d, stroke: color }),
    );
    group.points.forEach((point, pointIdx) => {
      const circle = createSvgElement('circle', {
        class: `data-point${pointIdx === group.points.length - 1 ? ' endpoint' : ''}`,
        cx: x(point.date).toFixed(1),
        cy: y(point.value).toFixed(1),
        r: pointIdx === group.points.length - 1 ? 4.2 : 3.3,
        fill: color,
      });
      const title = createSvgElement('title');
      title.textContent = `${group.label} · ${point.date} · ${formatNumber(point.value)}`;
      circle.append(title);
      seriesGroup.append(circle);
    });
    seriesGroup.append(createPointValueLabels(group.points, x, y, top, height - bottom, width - right));
    svg.append(seriesGroup);
  });
  return svg;
}

function createLegend(groups) {
  const legend = createElement('div', 'legend');
  groups.forEach((group, idx) => {
    const item = document.createElement('span');
    const swatch = createElement('i', 'swatch');
    swatch.style.background = COLORS[idx % COLORS.length];
    item.append(swatch, document.createTextNode(group.label));
    legend.append(item);
  });
  return legend;
}

function createSourceChartCard(sourceChart) {
  const article = createElement('article', 'source-chart-card');
  article.setAttribute('aria-label', `${sourceLabel(sourceChart.source)} 价格走势`);

  const heading = createElement('div', 'source-chart-heading');
  const titleBox = document.createElement('div');
  const eyebrow = createElement('p', 'eyebrow');
  const title = document.createElement('h3');
  const meta = createElement('p', 'source-chart-meta');
  const badge = createElement('span', 'source-chart-badge');
  eyebrow.textContent = '数据来源';
  title.textContent = sourceLabel(sourceChart.source);
  meta.textContent = `${formatNumber(sourceChart.rows.length)}条观测 · ${dateRangeLabel(sourceChart.rows)} · ${sourceChart.groups.length}/${sourceChart.allGroups.length}个系列`;
  badge.textContent = sourceChart.groups.length ? `${sourceChart.groups.length} series` : '暂无数据';
  titleBox.append(eyebrow, title, meta);
  heading.append(titleBox, badge);

  const frame = createElement('div', 'source-chart-frame');
  frame.append(createChartSvg(sourceChart.groups));

  article.append(heading, frame, createLegend(sourceChart.groups));
  return article;
}

function renderChart(rows) {
  const metric = document.getElementById('metric-filter').value;
  const limitValue = document.getElementById('series-limit').value;
  const sourceCharts = sourceBucketsForRows(rows).map((bucket) => {
    const allGroups = groupSeries(bucket.rows, metric);
    const groups = limitValue === 'all' ? allGroups : allGroups.slice(0, Number(limitValue));
    return { ...bucket, allGroups, groups };
  });
  const visibleCharts = sourceCharts.filter((sourceChart) => sourceChart.groups.length);
  const chart = document.getElementById('chart');
  chart.replaceChildren();
  renderFilterSummary(rows, sourceCharts, metric, limitValue);
  if (!visibleCharts.length) {
    const empty = createElement('div', 'empty-state');
    empty.textContent = '当前筛选条件下没有匹配的观测数据，请尝试更改价格类型或指标。';
    chart.append(empty);
    return;
  }

  chart.replaceChildren(...visibleCharts.map(createSourceChartCard));
}

function appendCell(row, value, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = value;
  row.append(td);
}

function appendBadgeCell(row, value, className = 'badge neutral', url = null) {
  const td = document.createElement('td');
  const badge = createElement(url ? 'a' : 'span', className);
  if (url) {
    badge.href = url;
    badge.target = '_blank';
    badge.rel = 'noopener noreferrer';
    badge.classList.add('source-link');
    badge.setAttribute('aria-label', `${value} 打开原始来源`);
  }
  badge.textContent = value;
  td.append(badge);
  row.append(td);
}

function renderTable(rows) {
  const metric = document.getElementById('metric-filter').value;
  const body = document.getElementById('latest-table');
  body.replaceChildren();
  const sortedRows = rows.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 50);
  setText('latest-caption', `${formatNumber(sortedRows.length)}条记录 · 所选指标: ${metricLabel(metric)} · 日期倒序`);
  if (!sortedRows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = '没有可显示的最新观测数据。';
    tr.append(td);
    body.append(tr);
    return;
  }
  sortedRows.forEach((obs) => {
    const tr = document.createElement('tr');
    const value = asFiniteNumber(metricFor(obs, metric));
    appendCell(tr, obs.date || '未知');
    appendBadgeCell(tr, kindLabel(obs.kind), obs.kind === 'contract' ? 'badge warn' : obs.kind === 'spot' ? 'badge good' : 'badge neutral');
    appendCell(tr, categoryLabel(observationCategory(obs)));
    appendCell(tr, obs.product_name || obs.product_id || '未知');
    appendBadgeCell(tr, sourceLabel(obs.source), 'badge neutral', obs.source_url || primarySourceUrl(obs.source));
    appendCell(tr, value === null ? '无数据' : `${formatNumber(value)} ${obs.currency || ''}`.trim());
    body.append(tr);
  });
}

function render() {
  refreshFilterOptions();
  const rows = selectedObservations();
  renderStatus();
  renderChart(rows);
  renderTable(rows);
  enableTableDrag();
}

async function init() {
  try {
    const [prices, series, status] = await Promise.all(['prices', 'series', 'status'].map(loadJsonFallback));
    state.prices = prices.observations || [];
    state.series = series.series || [];
    state.status = status;
    populateFilters();
    render();
  } catch (error) {
    const chart = document.getElementById('chart');
    chart.replaceChildren();
    const empty = createElement('div', 'empty-state');
    empty.textContent = `数据加载失败：${error.message}`;
    chart.append(empty);
  }
}

bindThemeToggle();
init();
