import { get } from 'svelte/store'

import { product, positions, chartResolution } from './stores'

let candles = []; // current candle set

// In ms
let start;
let end;

let chart;
let candlestickSeries;

let isLoadingCandles = false;

// how much history to load for each resolution (in ms)
const lookbacks = {
	300: 24 * 60 * 60 * 1000,
	900: 48 * 60 * 60 * 1000,
	3600: 12 * 24 * 60 * 60 * 1000
};

export function initChart() {

	let script = document.createElement("script");
	script.setAttribute("src", "https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js");
	document.body.appendChild(script);

	script.addEventListener("load", scriptLoaded, false);

	async function scriptLoaded() {

		let chartElem = document.getElementById('chart');
		let tradingRowElem = document.getElementById('trading-row');
		let chartDivWidth = tradingRowElem.offsetWidth * 0.65;
		let chartDivHeight = chartElem.offsetHeight;

		chart = LightweightCharts.createChart(chartElem, { width: chartDivWidth, height: chartDivHeight });
		
		window.onresize = () => {
			chartDivWidth = tradingRowElem.offsetWidth * 0.65;
			chartDivHeight = chartElem.offsetHeight;
			//console.log('chartDivWidth', chartDivWidth, chartDivHeight);
			chart.resize(chartDivWidth, chartDivHeight);
		};

		chart.applyOptions({
			timeScale: {
				timeVisible: true
			}
		});

		const resolution = get(chartResolution);

		candlestickSeries = chart.addCandlestickSeries();

		async function onVisibleLogicalRangeChanged(newVisibleLogicalRange) {
			//console.log('lvc', newVisibleLogicalRange);
		    // returns bars info in current visible range
		    const barsInfo = candlestickSeries.barsInLogicalRange(newVisibleLogicalRange);
		    //console.log(barsInfo);
		    if (barsInfo !== null && barsInfo.barsBefore < 5) {
	            // try to load additional historical data and prepend it to the series data
	            // use setData with additional data prepended
	            if (isLoadingCandles) return;
	            console.log('load additional data to the left');
	            isLoadingCandles = true;
	            await loadCandles(resolution, start - lookbacks[resolution], end - lookbacks[resolution], true);
	            isLoadingCandles = false;
	        }
		}

		function onVisibleTimeRangeChanged(newVisibleTimeRange) {
			//console.log('vc', newVisibleTimeRange);
		}

		chart.timeScale().subscribeVisibleTimeRangeChange(onVisibleTimeRangeChanged);

		chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleLogicalRangeChanged);

		console.log('chart loaded');

		loadPositionLines();

		applyWatermark();

	}

}

// timezone corrected time in seconds
function correctedTime(time) {
	const timezoneOffsetMinutes = new Date().getTimezoneOffset();
	//console.log('timezoneOffsetMinutes', timezoneOffsetMinutes);
	return time-(timezoneOffsetMinutes*60)
}

export function applyWatermark() {
	const _product = get(product).symbol;
	if (!_product) return;
	chart && chart.applyOptions({
	    watermark: {
	        color: 'rgba(11, 94, 29, 0.4)',
	        visible: true,
	        text: _product,
	        fontSize: 24,
	        horzAlign: 'left',
	        vertAlign: 'top',
	    },
	});
}

export async function setResolution(_resolution) {
	chartResolution.set(_resolution);
	await loadCandles(_resolution);
}

export async function loadCandles(_resolution, _start, _end, prepend) {

	console.log('called loadCandles', _resolution, _start, _end, prepend);

	let _product = get(product).symbol;

	console.log('candlestickSeries', candlestickSeries);
	console.log('_product', _product);

	if (!candlestickSeries || !_product) {
		// try again
		console.log('nope');
		setTimeout(() => {
			loadCandles(_resolution, _start, _end);
		}, 1000);
		return;
	}

	if (!_resolution) {
		_resolution = get(chartResolution);
	}

	//console.log('_product', _product);
	console.log('resolution', _resolution, lookbacks[_resolution]);

	if (!_start || !_end) { // test
		_start = Date.now() - lookbacks[_resolution];
		_end = Date.now();
	}

	start = _start;
	end = _end;

	const url_start = encodeURIComponent(new Date(start).toString());
	const url_end = encodeURIComponent(new Date(end).toString());

	const response = await fetch(`https://api.exchange.coinbase.com/products/${_product}/candles?granularity=${_resolution}&start=${url_start}&end=${url_end}`);
	const json = await response.json();

	//console.log('json', json);

	if (prepend) {
		// prepend candles to existing set
		let prepend_set = [];
		for (const item of json) {
			prepend_set.push({
				time: correctedTime(item[0]),
				low: item[1],
				high: item[2],
				open: item[3],
				close: item[4]
			});
		}
		prepend_set.reverse();
		candles = prepend_set.concat(candles);
	} else {
		candles = [];
		for (const item of json) {
			candles.push({
				time: correctedTime(item[0]),
				low: item[1],
				high: item[2],
				open: item[3],
				close: item[4]
			});
		}
		candles.reverse();
	}

	//console.log('data', data);

	// set data
	candlestickSeries.setData(candles);

	//chart.timeScale().fitContent();

}

export function onNewPrice(price, timestamp, _product) {
	// add data point to current candle set
	// use update with time = last time for this resolution
	// get last data point to update ohlc values based on given data point

	//candlestickSeries.update({ time: '2019-01-01', open: 60.71, high: 60.71, low: 53.39, close: 59.29 });

	const symbol = get(product).symbol;

	if (_product != symbol) return;

	let lastCandle = candles[candles.length - 1];

	if (!lastCandle) return;

	timestamp = correctedTime(timestamp/1000);

	const resolution = get(chartResolution);

	if (timestamp >= lastCandle.time + resolution) {
		// new candle
		let candle = {
			time: parseInt(resolution * parseInt(timestamp/resolution)),
			low: price,
			high: price,
			open: price,
			close: price
		}
		candles.push(candle);
		candlestickSeries.update(candle);
	} else {
		// update existing candle
		if (lastCandle.low > price) lastCandle.low = price;
		if (lastCandle.high < price) lastCandle.high = price;
		lastCandle.close = price;

		candles[candles.length - 1] = lastCandle;
		candlestickSeries.update(lastCandle);
	}

}

let pricelines = [];

export function loadPositionLines() {

	console.log('loadPositionLines');

	if (!candlestickSeries) {
		console.log('nope2');
		setTimeout(loadPositionLines, 1000);
		return;
	}

	clearPositionLines();

	const _positions = get(positions);

	console.log('_positions', _positions);

	for (const _pos of _positions) {

		//if (!_pos.price) continue;

		pricelines.push(
			candlestickSeries.createPriceLine({
			    price: _pos.price * 1 + 4280,
			    color: 'green',
			    lineWidth: 2,
			    lineStyle: LightweightCharts.LineStyle.Dotted,
			    axisLabelVisible: true,
			    title: _pos.amount,
			})
		);

	}

}

function clearPositionLines() {
	for (const priceline of pricelines) {
		candlestickSeries.removePriceLine(priceline);
	}
	pricelines = [];
}