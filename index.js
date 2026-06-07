// Configuration & Chart Global Instances
let chart;
let candlestickSeries;
let volumeSeries;

// Data holders
let candlestickData = [];
let volumeData = [];
let sma20Data = [];
let ema50Data = [];
const dateMap = {}; // Maps "YYYY-MM-DD" to index in candlestickData

// Indicators state
let smaSeries = null;
let emaSeries = null;
let showSma = false;
let showEma = false;

// Drawing tools state
let activeTool = 'cursor'; // 'cursor', 'trendline', 'horizontal', 'rectangle', 'long', 'short'
let trendlines = [];
let horizontalLines = [];

// Session Markings State
let sessionBoxes = [];
let showSessions = true;
let sessionCanvas = null;
let sessionCtx = null;

// Custom Canvas Drawings State
let customDrawings = [];
let drawingStart = null;
let drawingCurrent = null;
let selectedDrawingId = null;
let draggingDrawingId = null;
let dragHandleType = null;

// Initialize Page
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  startApp();
} else {
  window.addEventListener('DOMContentLoaded', startApp);
}

async function startApp() {
  initChart();
  loadDrawings();
  await loadAndParseData();
  setupSessionOverlay();
  setupEventListeners();
  setActiveTool('cursor');
}

// Setup Lightweight Charts
function initChart() {
  const container = document.getElementById('chart-viewport');
  
  chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: '#ffffff' },
      textColor: '#131722',
    },
    grid: {
      vertLines: { color: 'rgba(42, 46, 57, 0.06)' },
      horzLines: { color: 'rgba(42, 46, 57, 0.06)' },
    },
    rightPriceScale: {
      borderColor: 'rgba(42, 46, 57, 0.15)',
      autoScale: true,
    },
    timeScale: {
      borderColor: 'rgba(42, 46, 57, 0.15)',
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time, tickMarkType, locale) => {
        const date = new Date(time * 1000);
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        
        if (tickMarkType === 0) {
          return date.getUTCFullYear();
        } else if (tickMarkType === 1) {
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          return months[date.getUTCMonth()];
        } else if (tickMarkType === 2) {
          return date.getUTCDate();
        } else {
          return `${hours}:${minutes}`;
        }
      }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        width: 1,
        color: 'rgba(30, 34, 45, 0.2)',
        style: 3, // Dotted
      },
      horzLine: {
        width: 1,
        color: 'rgba(30, 34, 45, 0.2)',
        style: 3, // Dotted
      },
    },
    localization: {
      // Format timestamps as UTC strings matching the CSV representation in 12-hour AM/PM format
      timeFormatter: (timestamp) => {
        const date = new Date(timestamp * 1000);
        const y = date.getUTCFullYear();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const m = months[date.getUTCMonth()];
        const d = String(date.getUTCDate()).padStart(2, '0');
        
        let hours = date.getUTCHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // Convert 0 to 12
        const hh = String(hours).padStart(2, '0');
        const mm = String(date.getUTCMinutes()).padStart(2, '0');
        
        return `${d}-${m}-${y} ${hh}:${mm} ${ampm}`;
      }
    }
  });

  // Candlestick series initialization
  candlestickSeries = chart.addCandlestickSeries({
    upColor: '#089981',
    downColor: '#f23645',
    borderVisible: true,
    borderUpColor: '#089981',
    borderDownColor: '#f23645',
    wickUpColor: '#089981',
    wickDownColor: '#f23645',
  });

  // Tick volume histogram series
  volumeSeries = chart.addHistogramSeries({
    color: '#089981',
    priceFormat: {
      type: 'volume',
    },
    priceScaleId: 'volume-scale', // Set custom scale ID to overlay on the price scale
  });

  // Constrain volume series height to the bottom 15% of the viewport
  chart.priceScale('volume-scale').applyOptions({
    scaleMargins: {
      top: 0.85,
      bottom: 0,
    },
  });

  // Handle auto-resize on layout modifications
  const resizeObserver = new ResizeObserver(entries => {
    if (entries.length === 0) return;
    const { width, height } = entries[0].contentRect;
    chart.resize(width, height);
  });
  resizeObserver.observe(container);
}

// Read CSV data stream, parse lines and update loading overlay progress
async function loadAndParseData() {
  const progressEl = document.getElementById('loading-progress');
  const infoEl = document.getElementById('data-range-info');
  
  try {
    const response = await fetch('jan_jun_2026.csv');
    if (!response.ok) throw new Error(`HTTP status ${response.status}`);
    
    const contentLength = +response.headers.get('Content-Length') || 6193539;
    const reader = response.body.getReader();
    let receivedBytes = 0;
    const chunks = [];
    
    // Stream download chunks
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      
      const progress = Math.min(Math.round((receivedBytes / contentLength) * 90), 90);
      progressEl.textContent = `${progress}%`;
    }
    
    progressEl.textContent = '95% (Parsing...)';
    
    // Concatenate chunks to text
    const allChunks = new Uint8Array(receivedBytes);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }
    const text = new TextDecoder('utf-8').decode(allChunks);
    
    const lines = text.split('\n');
    let lastTimestamp = 0;
    
    // Parse tab-separated columns
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 6) continue;
      
      const dateStr = parts[0];  // "2026.02.24"
      const timeStr = parts[1];  // "09:15:00"
      const open = parseFloat(parts[2]);
      const high = parseFloat(parts[3]);
      const low = parseFloat(parts[4]);
      const close = parseFloat(parts[5]);
      const tickVol = parseInt(parts[6], 10);
      
      const standardDateStr = dateStr.replace(/\./g, '-');
      const dateParts = standardDateStr.split('-');
      const timeParts = timeStr.split(':');
      
      const year = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1;
      const day = parseInt(dateParts[2], 10);
      const hours = parseInt(timeParts[0], 10);
      const minutes = parseInt(timeParts[1], 10);
      const seconds = parseInt(timeParts[2], 10);
      
      // Parse as Broker Date (represented in UTC for shift calculations)
      const brokerDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
      
      // Determine if this broker date is before March 29, 2026 (Europe DST start)
      // Note: March is month index 2
      const isBeforeEuropeDST = (year === 2026 && month < 2) || (year === 2026 && month === 2 && day < 29);
      
      let shiftMinutes = 0;
      if (isBeforeEuropeDST) {
        // EET (UTC+2) to IST (UTC+5.5) = +3.5 hours (+210 minutes)
        shiftMinutes = 210;
      } else {
        // EEST (UTC+3) to IST (UTC+5.5) = +2.5 hours (+150 minutes)
        shiftMinutes = 150;
      }
      
      const istDate = new Date(brokerDate.getTime() + shiftMinutes * 60 * 1000);
      const timestamp = Math.floor(istDate.getTime() / 1000);
      
      if (isNaN(timestamp) || timestamp <= lastTimestamp) {
        continue; // Skip invalid or duplicate timestamps
      }
      lastTimestamp = timestamp;
      
      candlestickData.push({ time: timestamp, open, high, low, close });
      
      volumeData.push({
        time: timestamp,
        value: tickVol,
        color: close >= open ? 'rgba(8, 153, 129, 0.3)' : 'rgba(242, 54, 69, 0.3)'
      });
      
      // Index date coordinates in IST for date picker navigation
      const istYear = istDate.getUTCFullYear();
      const istMonth = String(istDate.getUTCMonth() + 1).padStart(2, '0');
      const istDay = String(istDate.getUTCDate()).padStart(2, '0');
      const istDateStr = `${istYear}-${istMonth}-${istDay}`;
      
      if (!dateMap[istDateStr]) {
        dateMap[istDateStr] = candlestickData.length - 1;
      }
    }
    
    progressEl.textContent = '100%';
    
    // Set data into series
    candlestickSeries.setData(candlestickData);
    volumeSeries.setData(volumeData);
    
    // Pre-calculate technical indicators
    calculateSma20();
    calculateEma50();
    
    // Pre-calculate session markings
    precalculateSessions();
    
    // Position timescale viewport to focus on the last 200 bars (TradingView default style)
    const totalBars = candlestickData.length;
    if (totalBars > 0) {
      const defaultBars = Math.min(200, totalBars);
      chart.timeScale().setVisibleRange({
        from: candlestickData[totalBars - defaultBars].time,
        to: candlestickData[totalBars - 1].time
      });
      
      const startText = lines[1].split('\t')[0] + ' ' + lines[1].split('\t')[1];
      const endText = lines[lines.length - 2].split('\t')[0] + ' ' + lines[lines.length - 2].split('\t')[1];
      infoEl.textContent = `Data Range: ${startText.replace(/\./g, '/')} to ${endText.replace(/\./g, '/')}`;
      
      // Initialize dynamic OHLCV panel with latest close price
      updateOhlcvDisplay(candlestickData[totalBars - 1]);
    }
    
    // Hide overlay
    document.getElementById('loading-overlay').classList.add('hidden');
    
  } catch (error) {
    console.error('Error loading data:', error);
    progressEl.textContent = 'Error Loading File';
    progressEl.style.color = 'var(--color-bearish)';
    document.querySelector('.loading-text').textContent = error.message;
  }
}

// Calculate 20 Simple Moving Average
function calculateSma20() {
  const smaPeriod = 20;
  let sum = 0;
  for (let i = 0; i < candlestickData.length; i++) {
    sum += candlestickData[i].close;
    if (i >= smaPeriod) {
      sum -= candlestickData[i - smaPeriod].close;
      sma20Data.push({
        time: candlestickData[i].time,
        value: sum / smaPeriod
      });
    }
  }
}

// Calculate 50 Exponential Moving Average
function calculateEma50() {
  const emaPeriod = 50;
  const k = 2 / (emaPeriod + 1);
  let ema = 0;
  let firstSum = 0;
  
  for (let i = 0; i < candlestickData.length; i++) {
    if (i < emaPeriod) {
      firstSum += candlestickData[i].close;
      if (i === emaPeriod - 1) {
        ema = firstSum / emaPeriod;
        ema50Data.push({
          time: candlestickData[i].time,
          value: ema
        });
      }
    } else {
      ema = candlestickData[i].close * k + ema * (1 - k);
      ema50Data.push({
        time: candlestickData[i].time,
        value: ema
      });
    }
  }
}

// Update Top stats values on crosshair movement
function updateOhlcvDisplay(candle) {
  const o = document.getElementById('val-o');
  const h = document.getElementById('val-h');
  const l = document.getElementById('val-l');
  const c = document.getElementById('val-c');
  const v = document.getElementById('val-v');
  const chg = document.getElementById('val-chg');
  
  if (!candle) return;
  
  o.textContent = candle.open.toFixed(2);
  h.textContent = candle.high.toFixed(2);
  l.textContent = candle.low.toFixed(2);
  c.textContent = candle.close.toFixed(2);
  
  // Crosshair query volume
  const volItem = volumeData.find(vd => vd.time === candle.time);
  v.textContent = volItem ? volItem.value.toLocaleString() : '--';
  
  const diff = candle.close - candle.open;
  const percent = (diff / candle.open) * 100;
  const sign = diff >= 0 ? '+' : '';
  
  chg.textContent = `${sign}${diff.toFixed(2)} (${sign}${percent.toFixed(2)}%)`;
  
  // Style class matches direction
  const clName = diff >= 0 ? 'up' : 'down';
  o.className = `val ${clName}`;
  h.className = `val ${clName}`;
  l.className = `val ${clName}`;
  c.className = `val ${clName}`;
  chg.className = `val ${clName}`;
}

// Manage toolbar tool toggling
function setActiveTool(tool) {
  activeTool = tool;
  
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  const btn = document.getElementById(`tool-${tool}`);
  if (btn) btn.classList.add('active');
  
  // Escape active states
  drawingStart = null;
  drawingCurrent = null;
  
  const statusHint = document.getElementById('active-tool-hint');
  
  if (sessionCanvas) {
    sessionCanvas.style.pointerEvents = 'none'; // Keep pass-through always
  }
  
  if (tool === 'cursor') {
    statusHint.textContent = 'Mode: Cursor (Drag to pan, scroll to zoom)';
    chart.applyOptions({ handleScroll: true, handleScale: true });
  } else if (tool === 'trendline') {
    statusHint.textContent = 'Mode: Trendline (Click start, move mouse, click end)';
    chart.applyOptions({ handleScroll: false, handleScale: false });
  } else if (tool === 'horizontal') {
    statusHint.textContent = 'Mode: Horizontal Line (Click anywhere on the chart)';
    chart.applyOptions({ handleScroll: true, handleScale: true });
  } else if (tool === 'rectangle') {
    statusHint.textContent = 'Mode: Rectangle (Click first corner, move mouse, click second corner)';
    chart.applyOptions({ handleScroll: false, handleScale: false });
  } else if (tool === 'long') {
    statusHint.textContent = 'Mode: Long Position (Click entry price, move mouse, click target)';
    chart.applyOptions({ handleScroll: false, handleScale: false });
  } else if (tool === 'short') {
    statusHint.textContent = 'Mode: Short Position (Click entry price, move mouse, click target)';
    chart.applyOptions({ handleScroll: false, handleScale: false });
  }
}

// Event Bindings
function setupEventListeners() {
  // Toolbar Buttons
  document.getElementById('tool-cursor').addEventListener('click', () => setActiveTool('cursor'));
  document.getElementById('tool-trendline').addEventListener('click', () => setActiveTool('trendline'));
  document.getElementById('tool-horizontal').addEventListener('click', () => setActiveTool('horizontal'));
  document.getElementById('tool-rectangle').addEventListener('click', () => setActiveTool('rectangle'));
  document.getElementById('tool-long').addEventListener('click', () => setActiveTool('long'));
  document.getElementById('tool-short').addEventListener('click', () => setActiveTool('short'));
  
  // Indicators
  document.getElementById('toggle-sma20').addEventListener('click', () => {
    showSma = !showSma;
    const btn = document.getElementById('toggle-sma20');
    if (showSma) {
      btn.classList.add('active');
      smaSeries = chart.addLineSeries({
        color: '#2962ff',
        lineWidth: 2,
        title: 'SMA 20',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      smaSeries.setData(sma20Data);
    } else {
      btn.classList.remove('active');
      if (smaSeries) {
        chart.removeSeries(smaSeries);
        smaSeries = null;
      }
    }
  });

  document.getElementById('toggle-ema50').addEventListener('click', () => {
    showEma = !showEma;
    const btn = document.getElementById('toggle-ema50');
    if (showEma) {
      btn.classList.add('active');
      emaSeries = chart.addLineSeries({
        color: '#ff9800',
        lineWidth: 2,
        title: 'EMA 50',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      emaSeries.setData(ema50Data);
    } else {
      btn.classList.remove('active');
      if (emaSeries) {
        chart.removeSeries(emaSeries);
        emaSeries = null;
      }
    }
  });

  document.getElementById('toggle-sessions').addEventListener('click', () => {
    showSessions = !showSessions;
    const btn = document.getElementById('toggle-sessions');
    if (showSessions) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Utilities
  document.getElementById('btn-clear').addEventListener('click', () => {
    // Clear Horizontals
    horizontalLines.forEach(line => candlestickSeries.removePriceLine(line));
    horizontalLines = [];
    
    // Clear Trendlines
    trendlines.forEach(series => chart.removeSeries(series));
    trendlines = [];
    
    // Clear Custom Drawings
    customDrawings = [];
    saveDrawings();
    selectedDrawingId = null;
    
    setActiveTool('cursor');
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    const total = candlestickData.length;
    if (total > 0) {
      const defaultBars = Math.min(200, total);
      chart.timeScale().setVisibleRange({
        from: candlestickData[total - defaultBars].time,
        to: candlestickData[total - 1].time
      });
    }
    setActiveTool('cursor');
  });

  // Date Jump Click
  document.getElementById('goto-date-btn').addEventListener('click', () => {
    const picker = document.getElementById('goto-date-picker');
    const selectedDate = picker.value;
    if (!selectedDate) return;
    
    const index = dateMap[selectedDate];
    if (index !== undefined) {
      const barsToDisplay = 100;
      const startIdx = Math.max(0, index - barsToDisplay);
      const endIdx = Math.min(candlestickData.length - 1, index + barsToDisplay);
      
      chart.timeScale().setVisibleRange({
        from: candlestickData[startIdx].time,
        to: candlestickData[endIdx].time
      });
    } else {
      alert(`No active trading records for date: ${selectedDate.replace(/-/g, '/')}`);
    }
  });

  // Handle Keyboard escape and deletion
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (drawingStart) {
        drawingStart = null;
        drawingCurrent = null;
      }
      setActiveTool('cursor');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (activeTool === 'cursor' && selectedDrawingId !== null) {
        customDrawings = customDrawings.filter(d => d.id !== selectedDrawingId);
        selectedDrawingId = null;
        saveDrawings();
      }
    }
  });

  // Crosshair move monitoring for values update
  chart.subscribeCrosshairMove((param) => {
    if (!param.time || param.point === undefined) {
      if (candlestickData.length > 0) {
        updateOhlcvDisplay(candlestickData[candlestickData.length - 1]);
      }
      return;
    }
    const candle = param.seriesData.get(candlestickSeries);
    if (candle) {
      updateOhlcvDisplay(candle);
    }
  });

  // Interactive Click Drawings Setup for Horizontal Line
  chart.subscribeClick((param) => {
    if (!param.point || !param.time) return;
    
    const price = candlestickSeries.coordinateToPrice(param.point.y);
    
    if (activeTool === 'horizontal') {
      const line = candlestickSeries.createPriceLine({
        price: price,
        color: '#2962ff',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: `H-Line: ${price.toFixed(2)}`,
      });
      horizontalLines.push(line);
      setActiveTool('cursor');
    }
  });

  // Attach capturing event listeners for drawing and selection on the viewport
  const viewport = document.getElementById('chart-viewport');
  if (viewport) {
    viewport.addEventListener('mousedown', handleViewportMouseDown, true);
    viewport.addEventListener('mousemove', handleViewportMouseMove, true);
    viewport.addEventListener('mouseup', handleViewportMouseUp, true);
    viewport.addEventListener('contextmenu', handleViewportContextMenu, true);
  }
}

// ----------------------------------------------------
// Session Marking Overlay Canvas & Pre-calculations
// ----------------------------------------------------

// Calculate start, end, high, low for Tokyo, London, and NY sessions
function precalculateSessions() {
  sessionBoxes = [];
  
  // Find all unique days in candlestickData
  const uniqueDays = [];
  let lastDayStr = '';
  for (const candle of candlestickData) {
    const date = new Date(candle.time * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const dayStr = `${y}-${m}-${d}`;
    if (dayStr !== lastDayStr) {
      uniqueDays.push({ year: y, month: date.getUTCMonth(), day: date.getUTCDate(), dayStr });
      lastDayStr = dayStr;
    }
  }
  
  // Helper to extract session min/max price and start/end times
  function getSessionStats(startTime, endTime) {
    let firstIdx = -1;
    let lastIdx = -1;
    
    // Fast binary search to find the index range
    let low = 0;
    let high = candlestickData.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (candlestickData[mid].time >= startTime) {
        firstIdx = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    
    if (firstIdx === -1 || candlestickData[firstIdx].time > endTime) {
      return null;
    }
    
    low = firstIdx;
    high = candlestickData.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (candlestickData[mid].time <= endTime) {
        lastIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    
    if (lastIdx === -1 || lastIdx < firstIdx) {
      return null;
    }
    
    // Calculate high and low price for this session window
    let sessionHigh = -Infinity;
    let sessionLow = Infinity;
    for (let i = firstIdx; i <= lastIdx; i++) {
      const c = candlestickData[i];
      if (c.high > sessionHigh) sessionHigh = c.high;
      if (c.low < sessionLow) sessionLow = c.low;
    }
    
    return {
      startTime: candlestickData[firstIdx].time,
      endTime: candlestickData[lastIdx].time,
      high: sessionHigh,
      low: sessionLow
    };
  }
  
  for (const d of uniqueDays) {
    // Check if date is before March 8, 2026 (daylight savings change)
    // Note: JS Date month is 0-indexed (0=Jan, 1=Feb, 2=Mar)
    const isBeforeDST = (d.year === 2026 && d.month < 2) || (d.year === 2026 && d.month === 2 && d.day <= 7);
    
    // 1. Asian (Tokyo) Session: 05:30 to 11:15 UTC
    const asianStart = Date.UTC(d.year, d.month, d.day, 5, 30, 0) / 1000;
    const asianEnd = Date.UTC(d.year, d.month, d.day, 11, 15, 0) / 1000;
    const asianStats = getSessionStats(asianStart, asianEnd);
    if (asianStats) {
      sessionBoxes.push({
        type: 'asian',
        colorBorder: 'rgba(13, 71, 161, 0.8)', // Darker Blue
        colorBg: 'rgba(13, 71, 161, 0.12)',
        ...asianStats
      });
    }
    
    // 2. London Session
    let lonStart, lonEnd;
    if (isBeforeDST) {
      lonStart = Date.UTC(d.year, d.month, d.day, 14, 0, 0) / 1000;
      lonEnd = Date.UTC(d.year, d.month, d.day, 21, 45, 0) / 1000;
    } else {
      lonStart = Date.UTC(d.year, d.month, d.day, 13, 0, 0) / 1000;
      lonEnd = Date.UTC(d.year, d.month, d.day, 20, 45, 0) / 1000;
    }
    const lonStats = getSessionStats(lonStart, lonEnd);
    if (lonStats) {
      sessionBoxes.push({
        type: 'london',
        colorBorder: 'rgba(191, 120, 0, 0.8)', // Darker Warm Gold
        colorBg: 'rgba(191, 120, 0, 0.12)',
        ...lonStats
      });
    }
    
    // 3. New York Session
    let nyStart, nyEnd;
    if (isBeforeDST) {
      nyStart = Date.UTC(d.year, d.month, d.day, 20, 0, 0) / 1000;
      nyEnd = (Date.UTC(d.year, d.month, d.day, 20, 0, 0) + (6.25 * 60 * 60 * 1000)) / 1000; // NY duration is 6h 15m
    } else {
      nyStart = Date.UTC(d.year, d.month, d.day, 19, 0, 0) / 1000;
      nyEnd = (Date.UTC(d.year, d.month, d.day, 19, 0, 0) + (6.25 * 60 * 60 * 1000)) / 1000;
    }
    const nyStats = getSessionStats(nyStart, nyEnd);
    if (nyStats) {
      sessionBoxes.push({
        type: 'newyork',
        colorBorder: 'rgba(55, 60, 75, 0.8)', // Darker Grey
        colorBg: 'rgba(55, 60, 75, 0.12)',
        ...nyStats
      });
    }
  }
}

// Find the main chart pane table cell and append the session canvas overlay
function setupSessionOverlay() {
  const container = document.getElementById('chart-viewport');
  const mainCanvas = document.querySelector('#chart-viewport canvas');
  if (!container || !mainCanvas) {
    setTimeout(setupSessionOverlay, 100);
    return;
  }
  
  container.style.position = 'relative';
  
  sessionCanvas = document.createElement('canvas');
  sessionCanvas.className = 'session-overlay-canvas';
  sessionCanvas.style.position = 'absolute';
  sessionCanvas.style.pointerEvents = 'none';
  sessionCanvas.style.zIndex = '3'; // Position it on top of the chart canvas
  
  container.appendChild(sessionCanvas);
  sessionCtx = sessionCanvas.getContext('2d');
  
  requestAnimationFrame(renderLoop);
}

// Fit canvas rendering resolution to display pixel density
function resizeOverlayCanvas() {
  if (!sessionCanvas) return;
  const mainCanvas = document.querySelector('#chart-viewport canvas');
  if (!mainCanvas) return;
  
  const rect = mainCanvas.getBoundingClientRect();
  const containerRect = document.getElementById('chart-viewport').getBoundingClientRect();
  
  // Align canvas layout position on top of the chart canvas
  sessionCanvas.style.left = (rect.left - containerRect.left) + 'px';
  sessionCanvas.style.top = (rect.top - containerRect.top) + 'px';
  sessionCanvas.style.width = rect.width + 'px';
  sessionCanvas.style.height = rect.height + 'px';
  
  const dpr = window.devicePixelRatio || 1;
  const width = rect.width * dpr;
  const height = rect.height * dpr;
  
  if (sessionCanvas.width !== width || sessionCanvas.height !== height) {
    sessionCanvas.width = width;
    sessionCanvas.height = height;
    sessionCtx.scale(dpr, dpr);
  }
}

// Frame-by-frame rendering loop to draw visible sessions
function renderLoop() {
  if (!sessionCanvas || !sessionCtx) return;
  
  resizeOverlayCanvas();
  
  // Clear previous frame
  sessionCtx.clearRect(0, 0, sessionCanvas.width / window.devicePixelRatio, sessionCanvas.height / window.devicePixelRatio);
  
  const timeScale = chart.timeScale();
  const visibleRange = timeScale.getVisibleRange();
  
  if (showSessions && visibleRange) {
    // Render boxes only if they intersect with the visible timescale range
    for (const box of sessionBoxes) {
      if (box.endTime < visibleRange.from || box.startTime > visibleRange.to) {
        continue;
      }
      
      const xStart = timeScale.timeToCoordinate(box.startTime);
      const xEnd = timeScale.timeToCoordinate(box.endTime);
      const yHigh = candlestickSeries.priceToCoordinate(box.high);
      const yLow = candlestickSeries.priceToCoordinate(box.low);
      
      if (xStart === null || xEnd === null || yHigh === null || yLow === null) {
        continue;
      }
      
      const width = xEnd - xStart;
      const height = yLow - yHigh;
      
      // Draw Box Fill
      sessionCtx.fillStyle = box.colorBg;
      sessionCtx.fillRect(xStart, yHigh, width, height);
      
      // Draw Session Text Label inside the box
      sessionCtx.fillStyle = box.colorBorder;
      sessionCtx.font = 'bold 9px Outfit, sans-serif';
      sessionCtx.textAlign = 'left';
      sessionCtx.textBaseline = 'top';
      
      let label = '';
      if (box.type === 'asian') label = 'ASIA';
      else if (box.type === 'london') label = 'LONDON';
      else if (box.type === 'newyork') label = 'NY';
      
      sessionCtx.fillText(label, xStart + 4, yHigh + 4);
    }
  }
  
  // Render Custom Drawings and Previews
  renderCustomDrawings();
  renderActivePreview();
  
  requestAnimationFrame(renderLoop);
}

// ----------------------------------------------------
// Custom Drawings Helpers & Rendering
// ----------------------------------------------------

function renderCustomDrawings() {
  for (const drawing of customDrawings) {
    drawShape(drawing, false, drawing.id === selectedDrawingId);
  }
}

function renderActivePreview() {
  if (drawingStart && drawingCurrent) {
    const tempDrawing = {
      type: activeTool,
      start: drawingStart,
      end: drawingCurrent
    };
    drawShape(tempDrawing, true, false);
  }
}

function drawShape(drawing, isPreview, isSelected) {
  if (!chart || !candlestickSeries || !sessionCtx) return;
  
  const type = drawing.type;
  const start = drawing.start;
  const end = drawing.end;
  
  const timeScale = chart.timeScale();
  const xStart = timeScale.timeToCoordinate(start.time);
  const xEnd = timeScale.timeToCoordinate(end.time);
  const yStart = candlestickSeries.priceToCoordinate(start.price);
  const yEnd = candlestickSeries.priceToCoordinate(end.price);
  
  if (xStart === null || xEnd === null || yStart === null || yEnd === null) return;
  
  sessionCtx.save();
  
  if (type === 'trendline') {
    sessionCtx.beginPath();
    sessionCtx.moveTo(xStart, yStart);
    sessionCtx.lineTo(xEnd, yEnd);
    
    sessionCtx.strokeStyle = '#2962ff';
    sessionCtx.lineWidth = 1; // Thin 1px line
    if (isPreview) {
      sessionCtx.setLineDash([4, 4]);
    } else {
      sessionCtx.setLineDash([]);
    }
    sessionCtx.stroke();
    
    if (isPreview || isSelected) {
      drawCircle(sessionCtx, xStart, yStart, 4.5, '#ffffff', '#2962ff');
      drawCircle(sessionCtx, xEnd, yEnd, 4.5, '#ffffff', '#2962ff');
    }
  } else if (type === 'rectangle') {
    const width = xEnd - xStart;
    const height = yEnd - yStart;
    
    sessionCtx.fillStyle = 'rgba(156, 39, 176, 0.05)';
    sessionCtx.fillRect(xStart, yStart, width, height);
    
    sessionCtx.beginPath();
    sessionCtx.rect(xStart, yStart, width, height);
    sessionCtx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    sessionCtx.lineWidth = 1; // Thin 1px border
    if (isPreview) {
      sessionCtx.setLineDash([4, 4]);
    } else {
      sessionCtx.setLineDash([]);
    }
    sessionCtx.stroke();
    
    if (isPreview || isSelected) {
      drawCircle(sessionCtx, xStart, yStart, 4, '#ffffff', 'rgba(0, 0, 0, 0.7)');
      drawCircle(sessionCtx, xEnd, yStart, 4, '#ffffff', 'rgba(0, 0, 0, 0.7)');
      drawCircle(sessionCtx, xStart, yEnd, 4, '#ffffff', 'rgba(0, 0, 0, 0.7)');
      drawCircle(sessionCtx, xEnd, yEnd, 4, '#ffffff', 'rgba(0, 0, 0, 0.7)');
    }
  } else if (type === 'long' || type === 'short') {
    const entryPrice = start.price;
    const targetPrice = end.price;
    
    let stopPrice = drawing.stopPrice;
    if (stopPrice === undefined) {
      const priceDiff = Math.abs(targetPrice - entryPrice);
      if (type === 'long') {
        stopPrice = entryPrice - priceDiff;
      } else {
        stopPrice = entryPrice + priceDiff;
      }
    }
    
    const yTarget = candlestickSeries.priceToCoordinate(targetPrice);
    const yStop = candlestickSeries.priceToCoordinate(stopPrice);
    
    if (yTarget === null || yStop === null) {
      sessionCtx.restore();
      return;
    }
    
    let minX = Math.min(xStart, xEnd);
    let maxX = Math.max(xStart, xEnd);
    let boxWidth = maxX - minX;
    if (boxWidth < 30) {
      maxX = minX + 120;
      boxWidth = 120;
    }
    
    let yGreenTop, yGreenBottom, yRedTop, yRedBottom;
    if (type === 'long') {
      yGreenTop = yTarget;
      yGreenBottom = yStart;
      yRedTop = yStart;
      yRedBottom = yStop;
    } else {
      yGreenTop = yStart;
      yGreenBottom = yTarget;
      yRedTop = yStop;
      yRedBottom = yStart;
    }
    
    // Fill Green Box (Target)
    sessionCtx.fillStyle = 'rgba(8, 153, 129, 0.14)';
    sessionCtx.fillRect(minX, yGreenTop, boxWidth, yGreenBottom - yGreenTop);
    
    // Fill Red Box (Stop Loss)
    sessionCtx.fillStyle = 'rgba(242, 54, 69, 0.14)';
    sessionCtx.fillRect(minX, yRedTop, boxWidth, yRedBottom - yRedTop);
    
    sessionCtx.lineWidth = 1; // Thin 1px border
    if (isPreview) {
      sessionCtx.setLineDash([3, 3]);
    } else {
      sessionCtx.setLineDash([]);
    }
    
    // Green Border
    sessionCtx.strokeStyle = 'rgba(8, 153, 129, 0.6)';
    sessionCtx.strokeRect(minX, yGreenTop, boxWidth, yGreenBottom - yGreenTop);
    
    // Red Border
    sessionCtx.strokeStyle = 'rgba(242, 54, 69, 0.6)';
    sessionCtx.strokeRect(minX, yRedTop, boxWidth, yRedBottom - yRedTop);
    
    // Entry Line (divider in the middle)
    sessionCtx.beginPath();
    sessionCtx.moveTo(minX, yStart);
    sessionCtx.lineTo(maxX, yStart);
    sessionCtx.strokeStyle = '#1e222d';
    sessionCtx.lineWidth = 1; // Thin 1px entry line
    sessionCtx.setLineDash([]);
    sessionCtx.stroke();
    
    if (isSelected || isPreview) {
      // Entry line handles
      drawCircle(sessionCtx, minX, yStart, 4.5, '#ffffff', '#1e222d');
      drawCircle(sessionCtx, maxX, yStart, 4.5, '#ffffff', '#1e222d');
      // Target line handles
      drawCircle(sessionCtx, minX, yTarget, 4, '#ffffff', 'rgba(8, 153, 129, 0.6)');
      drawCircle(sessionCtx, maxX, yTarget, 4, '#ffffff', 'rgba(8, 153, 129, 0.6)');
      // Stop line handles
      drawCircle(sessionCtx, minX, yStop, 4, '#ffffff', 'rgba(242, 54, 69, 0.6)');
      drawCircle(sessionCtx, maxX, yStop, 4, '#ffffff', 'rgba(242, 54, 69, 0.6)');
      
      const targetDiff = Math.abs(targetPrice - entryPrice);
      const stopDiff = Math.abs(entryPrice - stopPrice);
      
      const targetPct = (targetDiff / entryPrice) * 100;
      const stopPct = (stopDiff / entryPrice) * 100;
      const rr = stopDiff === 0 ? 0 : targetDiff / stopDiff;
      
      drawTargetBadge(minX + boxWidth / 2, yTarget, targetDiff, targetPct);
      drawStopBadge(minX + boxWidth / 2, yStop, stopDiff, stopPct);
      drawStatsCard(minX + boxWidth / 2, yStart, rr);
    }
  }
  
  sessionCtx.restore();
}

function drawCircle(ctx, x, y, r, fillColor, strokeColor) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawStatsCard(x, y, rr) {
  const text = `Risk/reward ratio: ${(rr !== undefined && !isNaN(rr)) ? rr.toFixed(2) : '1.00'}`;
  sessionCtx.save();
  sessionCtx.font = 'bold 10px Outfit, sans-serif';
  const textWidth = sessionCtx.measureText(text).width;
  
  const badgeWidth = textWidth + 16;
  const badgeHeight = 22;
  const bx = x - badgeWidth / 2;
  const by = y - badgeHeight / 2;
  
  sessionCtx.fillStyle = 'rgba(30, 34, 45, 0.95)';
  sessionCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  sessionCtx.lineWidth = 1;
  
  sessionCtx.beginPath();
  const radius = 4;
  if (sessionCtx.roundRect) {
    sessionCtx.roundRect(bx, by, badgeWidth, badgeHeight, radius);
  } else {
    sessionCtx.rect(bx, by, badgeWidth, badgeHeight);
  }
  sessionCtx.fill();
  sessionCtx.stroke();
  
  sessionCtx.fillStyle = '#ffffff';
  sessionCtx.textAlign = 'center';
  sessionCtx.textBaseline = 'middle';
  sessionCtx.fillText(text, x, y + 0.5);
  sessionCtx.restore();
}

function drawTargetBadge(x, y, priceDiff, pct) {
  const text = `Target: ${priceDiff.toFixed(2)} (${pct.toFixed(2)}%)`;
  sessionCtx.save();
  sessionCtx.font = 'bold 9px Outfit, sans-serif';
  const textWidth = sessionCtx.measureText(text).width;
  
  const badgeWidth = textWidth + 12;
  const badgeHeight = 16;
  const bx = x - badgeWidth / 2;
  const by = y - badgeHeight - 4;
  
  sessionCtx.fillStyle = '#089981';
  sessionCtx.beginPath();
  if (sessionCtx.roundRect) {
    sessionCtx.roundRect(bx, by, badgeWidth, badgeHeight, 3);
  } else {
    sessionCtx.rect(bx, by, badgeWidth, badgeHeight);
  }
  sessionCtx.fill();
  
  sessionCtx.fillStyle = '#ffffff';
  sessionCtx.textAlign = 'center';
  sessionCtx.textBaseline = 'middle';
  sessionCtx.fillText(text, x, by + badgeHeight / 2 + 0.5);
  sessionCtx.restore();
}

function drawStopBadge(x, y, priceDiff, pct) {
  const text = `Stop: ${priceDiff.toFixed(2)} (${pct.toFixed(2)}%)`;
  sessionCtx.save();
  sessionCtx.font = 'bold 9px Outfit, sans-serif';
  const textWidth = sessionCtx.measureText(text).width;
  
  const badgeWidth = textWidth + 12;
  const badgeHeight = 16;
  const bx = x - badgeWidth / 2;
  const by = y + 4;
  
  sessionCtx.fillStyle = '#f23645';
  sessionCtx.beginPath();
  if (sessionCtx.roundRect) {
    sessionCtx.roundRect(bx, by, badgeWidth, badgeHeight, 3);
  } else {
    sessionCtx.rect(bx, by, badgeWidth, badgeHeight);
  }
  sessionCtx.fill();
  
  sessionCtx.fillStyle = '#ffffff';
  sessionCtx.textAlign = 'center';
  sessionCtx.textBaseline = 'middle';
  sessionCtx.fillText(text, x, by + badgeHeight / 2 + 0.5);
  sessionCtx.restore();
}

function saveDrawings() {
  try {
    localStorage.setItem('xauusd_custom_drawings', JSON.stringify(customDrawings));
  } catch (e) {
    console.error('Failed to save drawings to localStorage:', e);
  }
}

function loadDrawings() {
  try {
    const saved = localStorage.getItem('xauusd_custom_drawings');
    if (saved) {
      customDrawings = JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load drawings from localStorage:', e);
  }
}

function handleViewportMouseDown(e) {
  if (e.button === 2) {
    if (activeTool !== 'cursor' && drawingStart) {
      e.stopPropagation();
      e.preventDefault();
      drawingStart = null;
      drawingCurrent = null;
      setActiveTool('cursor');
    }
    return;
  }

  if (e.button !== 0) return;
  
  const coords = getChartCoords(e);
  if (!coords) return;
  
  if (activeTool === 'cursor') {
    // Check if we clicked on an edit handle of the selected drawing
    if (selectedDrawingId !== null) {
      const selectedDrawing = customDrawings.find(d => d.id === selectedDrawingId);
      if (selectedDrawing) {
        const handle = getClickedHandle(selectedDrawing, coords.x, coords.y);
        if (handle) {
          draggingDrawingId = selectedDrawingId;
          dragHandleType = handle.type;
          e.stopPropagation();
          e.preventDefault();
          return;
        }
      }
    }
    
    // Otherwise, hit test to select a drawing
    const hit = hitTestDrawings(coords.x, coords.y);
    if (hit) {
      selectedDrawingId = hit.id;
      e.stopPropagation();
      e.preventDefault();
    } else {
      selectedDrawingId = null;
    }
    return;
  }
  
  if (activeTool === 'horizontal') return;
  
  e.stopPropagation();
  e.preventDefault();
  
  if (!drawingStart) {
    drawingStart = { time: coords.time, price: coords.price, x: coords.x, y: coords.y };
    drawingCurrent = { time: coords.time, price: coords.price, x: coords.x, y: coords.y };
  } else {
    // Second click: finalize
    let endTime = coords.time;
    if (endTime === drawingStart.time && candlestickData.length > 0) {
      const startIdx = candlestickData.findIndex(c => c.time === drawingStart.time);
      if (startIdx !== -1) {
        const endIdx = Math.min(candlestickData.length - 1, startIdx + 30);
        endTime = candlestickData[endIdx].time;
      } else {
        endTime = drawingStart.time + 30 * 60;
      }
    }
    let endPrice = coords.price;
    if (endPrice === drawingStart.price) {
      if (activeTool === 'long') {
        endPrice = drawingStart.price * 1.005;
      } else if (activeTool === 'short') {
        endPrice = drawingStart.price * 0.995;
      } else if (activeTool === 'rectangle') {
        endPrice = drawingStart.price * 0.998;
      }
    }
    
    const newDrawing = {
      id: 'draw_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      type: activeTool,
      start: { time: drawingStart.time, price: drawingStart.price },
      end: { time: endTime, price: endPrice }
    };
    customDrawings.push(newDrawing);
    saveDrawings();
    
    drawingStart = null;
    drawingCurrent = null;
    setActiveTool('cursor');
  }
}

function handleViewportMouseMove(e) {
  const coords = getChartCoords(e);
  if (!coords) return;
  
  if (activeTool !== 'cursor') {
    if (drawingStart) {
      drawingCurrent = { time: coords.time, price: coords.price, x: coords.x, y: coords.y };
      e.stopPropagation();
      e.preventDefault();
    }
    return;
  }
  
  // Dragging handles in cursor mode
  if (draggingDrawingId !== null && dragHandleType !== null) {
    const drawing = customDrawings.find(d => d.id === draggingDrawingId);
    if (drawing) {
      updateDrawingHandle(drawing, dragHandleType, coords.time, coords.price);
      saveDrawings();
      e.stopPropagation();
      e.preventDefault();
    }
  }
}

function handleViewportMouseUp(e) {
  if (draggingDrawingId !== null) {
    draggingDrawingId = null;
    dragHandleType = null;
    saveDrawings();
    e.stopPropagation();
    e.preventDefault();
  }
}

function handleViewportContextMenu(e) {
  if (activeTool !== 'cursor' || drawingStart) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function getClickedHandle(drawing, mouseX, mouseY) {
  if (!chart || !candlestickSeries) return null;
  const timeScale = chart.timeScale();
  const xStart = timeScale.timeToCoordinate(drawing.start.time);
  const xEnd = timeScale.timeToCoordinate(drawing.end.time);
  const yStart = candlestickSeries.priceToCoordinate(drawing.start.price);
  const yEnd = candlestickSeries.priceToCoordinate(drawing.end.price);
  
  if (xStart === null || xEnd === null || yStart === null || yEnd === null) return null;
  
  const threshold = 10;
  
  if (drawing.type === 'trendline') {
    if (getDistance(mouseX, mouseY, xStart, yStart) < threshold) return { type: 'start' };
    if (getDistance(mouseX, mouseY, xEnd, yEnd) < threshold) return { type: 'end' };
  } else if (drawing.type === 'rectangle') {
    if (getDistance(mouseX, mouseY, xStart, yStart) < threshold) return { type: 'corner0' };
    if (getDistance(mouseX, mouseY, xEnd, yStart) < threshold) return { type: 'corner1' };
    if (getDistance(mouseX, mouseY, xStart, yEnd) < threshold) return { type: 'corner2' };
    if (getDistance(mouseX, mouseY, xEnd, yEnd) < threshold) return { type: 'corner3' };
  } else if (drawing.type === 'long' || drawing.type === 'short') {
    const minX = Math.min(xStart, xEnd);
    const maxX = Math.max(xStart, xEnd);
    const entryPrice = drawing.start.price;
    const targetPrice = drawing.end.price;
    
    let stopPrice = drawing.stopPrice;
    if (stopPrice === undefined) {
      const priceDiff = Math.abs(targetPrice - entryPrice);
      if (drawing.type === 'long') {
        stopPrice = entryPrice - priceDiff;
      } else {
        stopPrice = entryPrice + priceDiff;
      }
    }
    
    const yTarget = candlestickSeries.priceToCoordinate(targetPrice);
    const yStop = candlestickSeries.priceToCoordinate(stopPrice);
    
    if (yTarget !== null && yStop !== null) {
      if (getDistance(mouseX, mouseY, minX, yStart) < threshold || getDistance(mouseX, mouseY, maxX, yStart) < threshold) {
        return { type: 'entry' };
      }
      if (getDistance(mouseX, mouseY, minX, yTarget) < threshold || getDistance(mouseX, mouseY, maxX, yTarget) < threshold) {
        return { type: 'target' };
      }
      if (getDistance(mouseX, mouseY, minX, yStop) < threshold || getDistance(mouseX, mouseY, maxX, yStop) < threshold) {
        return { type: 'stop' };
      }
    }
  }
  
  return null;
}

function updateDrawingHandle(drawing, handleType, time, price) {
  if (drawing.type === 'trendline') {
    if (handleType === 'start') {
      drawing.start.time = time;
      drawing.start.price = price;
    } else if (handleType === 'end') {
      drawing.end.time = time;
      drawing.end.price = price;
    }
  } else if (drawing.type === 'rectangle') {
    if (handleType === 'corner0') {
      drawing.start.time = time;
      drawing.start.price = price;
    } else if (handleType === 'corner1') {
      drawing.end.time = time;
      drawing.start.price = price;
    } else if (handleType === 'corner2') {
      drawing.start.time = time;
      drawing.end.price = price;
    } else if (handleType === 'corner3') {
      drawing.end.time = time;
      drawing.end.price = price;
    }
  } else if (drawing.type === 'long' || drawing.type === 'short') {
    if (handleType === 'entry') {
      const oldEntry = drawing.start.price;
      const priceDelta = price - oldEntry;
      
      if (drawing.stopPrice === undefined) {
        const priceDiff = Math.abs(drawing.end.price - oldEntry);
        if (drawing.type === 'long') {
          drawing.stopPrice = oldEntry - priceDiff;
        } else {
          drawing.stopPrice = oldEntry + priceDiff;
        }
      }
      
      drawing.start.price = price;
      drawing.start.time = time;
      drawing.end.price += priceDelta;
      drawing.stopPrice += priceDelta;
    } else if (handleType === 'target') {
      drawing.end.price = price;
      drawing.end.time = time;
    } else if (handleType === 'stop') {
      drawing.stopPrice = price;
      drawing.end.time = time;
    }
  }
}

function getDistance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function hitTestDrawings(x, y) {
  if (!chart || !candlestickSeries) return null;
  const timeScale = chart.timeScale();
  
  for (let i = customDrawings.length - 1; i >= 0; i--) {
    const drawing = customDrawings[i];
    const xStart = timeScale.timeToCoordinate(drawing.start.time);
    const xEnd = timeScale.timeToCoordinate(drawing.end.time);
    const yStart = candlestickSeries.priceToCoordinate(drawing.start.price);
    const yEnd = candlestickSeries.priceToCoordinate(drawing.end.price);
    
    if (xStart === null || xEnd === null || yStart === null || yEnd === null) continue;
    
    if (drawing.type === 'trendline') {
      const dist = getDistanceToSegment(x, y, xStart, yStart, xEnd, yEnd);
      if (dist < 8) {
        return drawing;
      }
    } else if (drawing.type === 'rectangle') {
      const minX = Math.min(xStart, xEnd);
      const maxX = Math.max(xStart, xEnd);
      const minY = Math.min(yStart, yEnd);
      const maxY = Math.max(yStart, yEnd);
      
      if (x >= minX - 4 && x <= maxX + 4 && y >= minY - 4 && y <= maxY + 4) {
        return drawing;
      }
    } else if (drawing.type === 'long' || drawing.type === 'short') {
      const minX = Math.min(xStart, xEnd);
      const maxX = Math.max(xStart, xEnd);
      
      const entryPrice = drawing.start.price;
      const targetPrice = drawing.end.price;
      const priceDiff = Math.abs(targetPrice - entryPrice);
      
      let stopPrice = drawing.stopPrice;
      if (stopPrice === undefined) {
        if (drawing.type === 'long') {
          stopPrice = entryPrice - priceDiff;
        } else {
          stopPrice = entryPrice + priceDiff;
        }
      }
      
      const prices = [entryPrice, targetPrice, stopPrice];
      const ys = prices.map(p => candlestickSeries.priceToCoordinate(p));
      if (ys.some(val => val === null)) continue;
      
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      
      if (x >= minX - 4 && x <= maxX + 4 && y >= minY - 4 && y <= maxY + 4) {
        return drawing;
      }
    }
  }
  return null;
}

function getDistanceToSegment(x, y, x1, y1, x2, y2) {
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  let param = -1;
  if (len_sq !== 0) param = dot / len_sq;
  
  let xx, yy;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  const dx = x - xx;
  const dy = y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

function getChartCoords(e) {
  if (!chart || !candlestickSeries || !sessionCanvas) return null;
  
  const rect = sessionCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  const timeScale = chart.timeScale();
  let time = timeScale.coordinateToTime(x);
  
  if (time === null && candlestickData.length > 0) {
    if (x < 0) {
      time = candlestickData[0].time;
    } else {
      time = candlestickData[candlestickData.length - 1].time;
    }
  }
  
  const price = candlestickSeries.coordinateToPrice(y);
  
  return { time, price, x, y };
}
