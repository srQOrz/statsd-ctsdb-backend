/*
 * Flush stats to ElasticSearch (http://www.elasticsearch.org/)
 *
 * To enable this backend, include 'elastic' in the backends
 * configuration array:
 *
 *   backends: ['./backends/elastic']
 *  (if the config file is in the statsd folder)
 *
 * A sample configuration can be found in exampleElasticConfig.js
 *
 * This backend supports the following config options:
 *
 *   host:            hostname or IP of ElasticSearch server
 *   port:            port of Elastic Search Server
 *   path:            http path of Elastic Search Server (default: '/')
 *   indexPrefix:     Prefix of the dynamic index to be created (default: 'statsd')
 *   indexTimestamp:  Timestamping format of the index, either "year", "month", "day", or "hour"
 *   indexType:       The dociment type of the saved stat (default: 'stat')
 */

var net = require('net'),
    util = require('util'),
    http = require('http');
request = require('request');
const http2 = require('http2');
// this will be instantiated to the logger
var lg;
var debug;
var flushInterval;
var elasticHost;
var elasticPort;
var elasticPath;
var elasticIndex;
var elasticIndexTimestamp;
var elasticCountType;
var elasticTimerType;
var elasticUsername;
var elasticPassword;

var elasticStats = {};


var es_bulk_insert = function elasticsearch_bulk_insert(listCounters, listTimers, listTimerData, listGaugeData) {

    var renderKV = function(k, v) {
        if (typeof v == 'number') {
            return '"'+k+'":'+v;
        }
        return '"'+k+'":"'+v+'"';
        /*
        if (k === '@timestamp') {
          var s = new Date(v).toISOString();
          return '"'+k+'":"'+s+'"';
        } else if (k === 'val') {
          return '"'+k+'":'+v;
        } else {
          return '"'+k+'":"'+v+'"';
        }
        */
    };

    var indexDate = new Date();

    var statsdIndex = elasticIndex + '-' + indexDate.getUTCFullYear()

    if (elasticIndexTimestamp == 'month' || elasticIndexTimestamp == 'day' || elasticIndexTimestamp == 'hour'){
        var indexMo = indexDate.getUTCMonth() +1;
        if (indexMo < 10) {
            indexMo = '0'+indexMo;
        }
        statsdIndex += '.' + indexMo;
    }

    if (elasticIndexTimestamp == 'day' || elasticIndexTimestamp == 'hour'){
        var indexDt = indexDate.getUTCDate();
        if (indexDt < 10) {
            indexDt = '0'+indexDt;
        }
        statsdIndex += '.' +  indexDt;
    }

    if (elasticIndexTimestamp == 'hour'){
        var indexDt = indexDate.getUTCHours();
        if (indexDt < 10) {
            indexDt = '0'+indexDt;
        }
        statsdIndex += '.' +  indexDt;
    }

    var payload = '';
    for (key in listCounters) {
        payload += '{"index":{}}'+"\n";
        payload += '{';
        innerPayload = '';
        for (statKey in listCounters[key]){
            if (innerPayload) innerPayload += ',';
            innerPayload += renderKV(statKey, listCounters[key][statKey]);
            //innerPayload += '"'+statKey+'":"'+listCounters[key][statKey]+'"';
        }
        payload += innerPayload +'}'+"\n";
    }
    for (key in listTimers) {
        payload += '{"index":{}}'+"\n";
        payload += '{';
        innerPayload = '';
        for (statKey in listTimers[key]){
            if (innerPayload) innerPayload += ',';
            innerPayload += renderKV(statKey, listTimers[key][statKey]);
            //innerPayload += '"'+statKey+'":"'+listTimers[key][statKey]+'"';
        }
        payload += innerPayload +'}'+"\n";
    }
    for (key in listTimerData) {
        payload += '{"index":{}}'+"\n";
        payload += '{';
        innerPayload = '';
        for (statKey in listTimerData[key]){
            if (innerPayload) innerPayload += ',';
            innerPayload += renderKV(statKey, listTimerData[key][statKey]);
            //innerPayload += '"'+statKey+'":"'+listTimerData[key][statKey]+'"';
        }
        payload += innerPayload +'}'+"\n";
    }
    for (key in listGaugeData) {
        payload += '{"index":{}}'+"\n";
        payload += '{';
        innerPayload = '';
        for (statKey in listGaugeData[key]){
            if (innerPayload) innerPayload += ',';
            innerPayload += renderKV(statKey, listGaugeData[key][statKey]);
            //innerPayload += '"'+statKey+'":"'+listGaugeData[key][statKey]+'"';
        }
        payload += innerPayload +'}'+"\n";
    }

	var urlHost = elasticHost;
    if(elasticPort !== '') {
        urlHost = elasticHost + ':' + elasticPort;
    }
    var options = {
        url: urlHost + elasticPath + '/' + elasticMetrics + '/_doc/_bulk',
        headers: {
            'Content-Type': 'application/json',
        },
        auth: {
            user: elasticUsername,
            password: elasticPassword
        },
        body: payload
    }

    if(payload !== '') {
        request.post(options, (err, res, body) => {
            if(err) {
                return lg.log("error:" + err);
            }
            else if(res.body !== undefined && JSON.parse(res.body).error !== undefined) {
                lg.log('error: ' + JSON.stringify(JSON.parse(res.body).error));
            }
            if (debug) {
                lg.log(JSON.stringify(body));
            }
        })
    }

    if (debug) {
        lg.log('ES payload:');
        lg.log(payload);
    }

}

var flush_stats = function elastic_flush(ts, metrics) {
    var statString = '';
    var numStats = 0;
    var key;
    var array_counts     = new Array();
    var array_timers     = new Array();
    var array_timer_data = new Array();
    var array_gauges     = new Array();

    ts = ts*1000;
    /*
      var gauges = metrics.gauges;
      var pctThreshold = metrics.pctThreshold;
    */

    for (key in metrics.counters) {
        if(!key.startsWith('statsd')) {
            numStats += fm.counters(key, metrics.counters[key], ts, array_counts);
        }
    }

    for (key in metrics.timers) {
        numStats += fm.timers(key, metrics.timers[key], ts, array_timers);
    }

    if (array_timers.length > 0) {
        for (key in metrics.timer_data) {
            fm.timer_data(key, metrics.timer_data[key], ts, array_timer_data);
        }
    }

    for (key in metrics.gauges) {
        numStats += fm.gauges(key, metrics.gauges[key], ts, array_gauges);
    }
    if (debug) {
        lg.log('metrics:');
        lg.log( JSON.stringify(metrics) );
    }

    es_bulk_insert(array_counts, array_timers, array_timer_data, array_gauges);

    if (debug) {
        lg.log("debug", "flushed " + numStats + " stats to ES");
    }
};

var elastic_backend_status = function (writeCb) {
    for (stat in elasticStats) {
        writeCb(null, 'elastic', stat, elasticStats[stat]);
    }
};

exports.init = function elasticsearch_init(startup_time, config, events, logger) {

    debug = config.debug;
    lg = logger;

    var configEs = config.ctsdb || { };

    elasticHost           = configEs.host           || 'localhost';
    elasticPort           = configEs.port           || '';
    elasticPath           = configEs.path           || '';
    elasticIndex          = configEs.indexPrefix    || 'statsd';
    elasticIndexTimestamp = configEs.indexTimestamp || 'day';
    elasticCountType      = configEs.countType      || 'counter';
    elasticTimerType      = configEs.timerType      || 'timer';
    elasticTimerDataType  = configEs.timerDataType  || elasticTimerType + '_stats';
    elasticGaugeDataType  = configEs.gaugeDataType  || 'gauge';
    elasticFormatter      = configEs.formatter      || 'default_format';
    elasticUsername       = configEs.username       || undefined;
    elasticPassword       = configEs.password       || undefined;
    elasticMetrics        = configEs.metrics        || '';

    fm   = require('./' + elasticFormatter + '.js')
    if (debug) {
        lg.log("debug", "loaded formatter " + elasticFormatter);
    }

    if (fm.init) {
        fm.init(configEs);
    }
    flushInterval         = config.flushInterval;

    elasticStats.last_flush = startup_time;
    elasticStats.last_exception = startup_time;


    events.on('flush', flush_stats);
    events.on('status', elastic_backend_status);

    return true;
};

