﻿// **********************************************************************************
// Websocket backend for the Moteino IoT Framework
// http://lowpowerlab.com/gateway
// **********************************************************************************
// Based on Node.js, socket.io, node-serialport, NeDB
// This is a work in progress and is released without any warranties expressed or implied.
// Please read the details below.
// Also ensure you change the settings in this file to match your hardware and email settings etc.
// **********************************************************************************
// NeDB is Node Embedded Database - a persistent database for Node.js, with no dependency
// Specs and documentation at: https://github.com/louischatriot/nedb
//
// Under the hood, NeDB's persistence uses an append-only format, meaning that all updates 
// and deletes actually result in lines added at the end of the datafile. The reason for
// this is that disk space is very cheap and appends are much faster than rewrites since
// they don't do a seek. The database is automatically compacted (i.e. put back in the
// one-line-per-document format) everytime your application restarts.
// 
// This script is configured to compact the database every 24 hours since time of start.
// ********************************************************************************************
// Copyright Felix Rusu, Low Power Lab LLC (2015), http://lowpowerlab.com/contact
// ********************************************************************************************
//                                    LICENSE
// ********************************************************************************************
// This source code is released under GPL 3.0 with the following ammendments:
// You are free to use, copy, distribute and transmit this Software for non-commercial purposes.
// - You cannot sell this Software for profit while it was released freely to you by Low Power Lab LLC.
// - You may freely use this Software commercially only if you also release it freely,
//   without selling this Software portion of your system for profit to the end user or entity.
//   If this Software runs on a hardware system that you sell for profit, you must not charge
//   any fees for this Software, either upfront or for retainer/support purposes
// - If you want to resell this Software or a derivative you must get permission from Low Power Lab LLC.
// - You must maintain the attribution and copyright notices in any forks, redistributions and
//   include the provided links back to the original location where this work is published,
//   even if your fork or redistribution was initially an N-th tier fork of this original release.
// - You must release any derivative work under the same terms and license included here.
// - This Software is released without any warranty expressed or implied, and Low Power Lab LLC
//   will accept no liability for your use of the Software (except to the extent such liability
//   cannot be excluded as required by law).
// - Low Power Lab LLC reserves the right to adjust or replace this license with one
//   that is more appropriate at any time without any prior consent.
// Otherwise all other non-conflicting and overlapping terms of the GPL terms below will apply.
// ********************************************************************************************
// This program is free software; you can redistribute it and/or modify it under the terms 
// of the GNU General Public License as published by the Free Software Foundation;
// either version 3 of the License, or (at your option) any later version.                    
//                                                        
// This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
// without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
// See the GNU General Public License for more details.
//                                                        
// You should have received a copy of the GNU General Public License along with this program.
// If not license can be viewed at: http://www.gnu.org/licenses/gpl-3.0.txt
//
// Please maintain this license information along with authorship
// and copyright notices in any redistribution of this code
// **********************************************************************************
//
// IMPORTANT details about NeDB:
// _id field is special - if not used it is automatically added and used as unique index
//                      - we can set that field when inserting to use it as an automatic unique index for fast lookups of nodes (by node Id)
io = require('socket.io').listen(8080);
var serialport = require("serialport");
var Datastore = require('nedb');
var nodemailer = require('nodemailer'); //using nodemailer: https://github.com/andris9/Nodemailer
var db = new Datastore({ filename: __dirname + '/gateway.db', autoload: true });       //used to keep all node/metric data
var dbLog = new Datastore({ filename: __dirname + '/gatewayLog.db', autoload: true }); //used to keep all logging/graph data
var dbunmatched = new Datastore({ filename: __dirname + '/gateway_nonmatches.db', autoload: true });
// change "/dev/ttyAMA0" to whatever your Pi's GPIO serial port is
var serial = new serialport.SerialPort("/dev/ttyAMA0", { baudrate : 115200, parser: serialport.parsers.readline("\n") });
var metricsDef = require('./metrics.js');
db.persistence.setAutocompactionInterval(86400000); //daily

dbLog.ensureIndex({ fieldName: 'n' }, function (err) { if (err) console.log('dbLog EnsureIndex[n] Error:' + err); });
dbLog.ensureIndex({ fieldName: 'm' }, function (err) { if (err) console.log('dbLog EnsureIndex[m] Error:' + err); });

var transporter = nodemailer.createTransport({
    service: 'gmail', //"gmail" is preconfigured by nodemailer, but you can setup any other email client supported by nodemailer
    auth: {
        user: '___YOU___@gmail.com',
        pass: '___GMAIL_PASSWORD_OR_ACCESS_TOKEN___'
    }
});

global.LOG = function(data) { process.stdout.write(data || ''); }
global.LOGln = function(data) { process.stdout.write((data || '') + '\n'); }
global.sendEmail = function(SUBJECT, BODY) {
  var mailOptions = {
      from: 'Moteino Gateway <gateway@moteino.com>',
      to: '___YOU___@gmail.com', // list of receivers, comma separated
      subject: SUBJECT,
      text: BODY
      //html: '<b>Hello world ?</b>' // html body
  };
  transporter.sendMail(mailOptions, function(error, info) {
    if(error) console.log('SENDEMAIL ERROR: ' + error);
    else console.log('SENDEMAIL SUCCESS: ' + info.response);
  });
}

global.sendSMS = function(SUBJECT, BODY) {
  var mailOptions = {
      from: 'Moteino Gateway <gateway@moteino.com>',
      to: '__CELL_PHONE_NO__@txt.att.net', //your mobile carrier should have an email address that will generate a SMS to your phone
      subject: SUBJECT,
      text: BODY
  };
  transporter.sendMail(mailOptions, function(error, info) {
    if(error) console.log('SENDSMS error: ' + error);
    else console.log('SENDSMS SUCCESS: ' + info.response);
  });
}

global.sendMessageToNode = function(node) {
  if (node.nodeId && node.action)
  {
    serial.write(node.nodeId + ':' + node.action)
    console.log('NODEACTION: ' + JSON.stringify(node));    
  }
}

global.handleNodeEvents = function(node) {
  if (node.events)
  {
    for (var key in node.events)
    {
      var enabled = node.events[key];
      if (enabled)
      {
        var evt = metricsDef.events[key]; 
        if (evt.serverExecute!=undefined)
          try {
            evt.serverExecute(node);
          }
          catch(ex) {console.log('Event ' + key + ' execution failed: ' + ex.message);}
      }
    }
  }
  // if (metricsDef.motes[node.type] && metricsDef.motes[node.type].events)
    // for (var eKey in metricsDef.motes[node.type].events)
    // {
      // var nodeEvent = metricsDef.motes[node.type].events[eKey];
      // if (nodeEvent.serverExecute != undefined)
        // nodeEvent.serverExecute(node);
    // }
}

//authorize handshake - make sure the request is coming from nginx, not from the outside world
//if you comment out this section, you will be able to hit this socket directly at the port it's running at, from anywhere!
//this was tested on Socket.IO v1.2.1 and will not work on older versions
io.use(function(socket, next) {
  var handshakeData = socket.request;
  //console.log('\nAUTHORIZING CONNECTION FROM ' + handshakeData.connection.remoteAddress + ':' + handshakeData.connection.remotePort);
  if (handshakeData.connection.remoteAddress == "localhost" || handshakeData.connection.remoteAddress == "127.0.0.1")
    next();
  next(new Error('REJECTED IDENTITY, not coming from localhost'));
});

io.sockets.on('connection', function (socket) {
  var address = socket.request.connection.remoteAddress;
  var port = socket.request.connection.remotePort;
  console.log("NEW CONNECTION FROM " + address + ":" + port);
  socket.emit('MOTESDEF', metricsDef.motes);
  socket.emit('METRICSDEF', metricsDef.metrics);
  socket.emit('EVENTSDEF', metricsDef.events);
  
  db.find({ _id : { $exists: true } }, function (err, entries) {
    //console.log("New connection found docs: " + entries.length);
    socket.emit('UPDATENODES', entries);
  });
  
  socket.on('UPDATENODESETTINGS', function (node) {
    db.find({ _id : node._id }, function (err, entries) {
      if (entries.length == 1)
      {
        var dbNode = entries[0];
        dbNode.type = node.type||undefined;
        dbNode.label = node.label||undefined;
        dbNode.descr = node.descr||undefined;
        dbNode.hidden = (node.hidden == 1 ? 1 : undefined);
        db.update({ _id: dbNode._id }, { $set : dbNode}, {}, function (err, numReplaced) { /*console.log('UPDATENODESETTINGS records replaced:' + numReplaced);*/ });
        io.sockets.emit('UPDATENODE', dbNode); //post it back to all clients to confirm UI changes
        //console.log("UPDATE NODE SETTINGS found docs:" + entries.length);
      }
    });
  });
  
  socket.on('UPDATEMETRICSETTINGS', function (nodeId, metricKey, metric) {
    db.find({ _id : nodeId }, function (err, entries) {
      if (entries.length == 1)
      {
        var dbNode = entries[0];
        dbNode.metrics[metricKey].label = metric.label;
        dbNode.metrics[metricKey].pin = metric.pin;
        dbNode.metrics[metricKey].graph = metric.graph;
        db.update({ _id: dbNode._id }, { $set : dbNode}, {}, function (err, numReplaced) { /*console.log('UPDATEMETRICSETTINGS records replaced:' + numReplaced);*/ });
        io.sockets.emit('UPDATENODE', dbNode); //post it back to all clients to confirm UI changes
      }
    });
  });

  socket.on('EDITNODEEVENT', function (nodeId, eventKey, enabled, remove) {
    //console.log('**** EDITNODEEVENT  **** key:' + eventKey + ' enabled:' + enabled + ' remove:' + remove);
    db.find({ _id : nodeId }, function (err, entries) {
      if (entries.length == 1)
      {
        var dbNode = entries[0];

        //cross check key to ensure it exists, then add it to the node events collection and persist to DB
        for(var key in metricsDef.events)
          if (eventKey == key)
          {
            if (!dbNode.events) dbNode.events = {};
            dbNode.events[eventKey] = (remove ? undefined : (enabled ? 1 : 0));
            db.update({ _id: dbNode._id }, { $set : dbNode}, {}, function (err, numReplaced) { /*console.log('UPDATEMETRICSETTINGS records replaced:' + numReplaced);*/ });
            
            if (metricsDef.events[eventKey] && metricsDef.events[eventKey].scheduledExecute)
              if (enabled && !remove)
                schedule(dbNode, eventKey);
              else //either disabled or removed
                for(var s in scheduledEvents)
                  if (scheduledEvents[s].nodeId == nodeId && scheduledEvents[s].eventKey == eventKey)
                  {
                    console.log('**** REMOVING SCHEDULED EVENT - nodeId:' + nodeId + ' event:' + eventKey);
                    clearTimeout(scheduledEvents[s].timer);
                    scheduledEvents.splice(scheduledEvents.indexOf(scheduledEvents[s]), 1)
                  }

            io.sockets.emit('UPDATENODE', dbNode); //post it back to all clients to confirm UI changes
            return;
          }
      }
    });
  });
  
  socket.on('DELETENODE', function (nodeId) {
    db.remove({ _id : nodeId }, function (err, removedCount) {
      console.log('DELETED entries: ' + removedCount);
      db.find({ _id : { $exists: true } }, function (err, entries) {
        io.sockets.emit('UPDATENODES', entries);
      });
    });
    
    for(var s in scheduledEvents)
      if (scheduledEvents[s].nodeId == nodeId)
      {
        console.log('**** REMOVING SCHEDULED EVENT FOR DELETED NODE - NodeId:' + nodeId + ' event:' + scheduledEvents[s].eventKey);
        clearTimeout(scheduledEvents[s].timer);
        scheduledEvents.splice(scheduledEvents.indexOf(scheduledEvents[s]), 1);
      }
  });
  
  socket.on('DELETENODEMETRIC', function (nodeId, metricKey) {
    db.find({ _id : nodeId }, function (err, entries) {
      if (entries.length == 1)
      {
        var dbNode = entries[0];
        dbNode.metrics[metricKey] = undefined;
        db.update({ _id: dbNode._id }, { $set : dbNode}, {}, function (err, numReplaced) { console.log('DELETENODEMETRIC DB-Replaced:' + numReplaced); });
        io.sockets.emit('UPDATENODE', dbNode); //post it back to all clients to confirm UI changes
      }
    });
  });

  socket.on('NODEACTION', function (data) {
    sendMessageToNode(data);
  });

  socket.on('GETGRAPHDATA', function (nodeId, metricKey, start, end) {
    dbLog.find({n:nodeId, m:metricKey, $and: [{_id:{$gte:start}}, {_id:{$lte:end}}]}, function (err, entries) {
      console.log('==>GETGRAPHDATA found: ' + entries.length + ' data points - nodeId:' + nodeId + ', m:' + metricKey);
      
      var graphOptions;
      for(var k in metricsDef.metrics)
      {
        if (metricsDef.metrics[k].name == metricKey && metricsDef.metrics[k].graphOptions != undefined)
        {
          graphOptions = metricsDef.metrics[k].graphOptions;
          break;
        }
      }
      
      for(var k in entries) entries[k].m=entries[k].n=undefined; //remove everything but the time and value, reduces socket traffic
      
      socket.emit('GRAPHDATAREADY', { data:entries, options : graphOptions });
    });
  });
});

global.msgHistory = new Array();
serial.on("data", function (data) {
  var regexMaster = /\[(\d+)\](.+)\[(?:RSSI|SS)\:-?(\d+)\].*/gi; //modifiers: g:global i:caseinsensitive
  var match = regexMaster.exec(data);
  console.log('>: ' + data)
  
  if (match != null)
  {
    var msgTokens = match[2];
    var id = parseInt(match[1]); //get ID of node
    var rssi = parseInt(match[3]); //get rssi (signal strength)

    db.find({ _id : id }, function (err, entries) {
      var existingNode = new Object();
      if (entries.length == 1)
      { //update
        existingNode = entries[0];
      }
      
      //check for duplicate messages - this can happen when the remote node sends an ACK-ed message but does not get the ACK so it resends same message repeatedly until it receives an ACK
      if (existingNode.updated != undefined && ((new Date) - new Date(existingNode.updated).getTime()) < 500 && msgHistory[id] == msgTokens)
      { console.log("   DUPLICATE, skipping..."); return; }
      
      msgHistory[id] = msgTokens;

      //console.log('FOUND ENTRY TO UPDATE: ' + JSON.stringify(existingNode));    
      existingNode._id = id;
      existingNode.rssi = rssi; //update signal strength we last heard from this node, regardless of any matches
      existingNode.updated = new Date().getTime(); //update timestamp we last heard from this node, regardless of any matches
      if (existingNode.metrics == undefined)
        existingNode.metrics = new Object();
      if (existingNode.events == undefined)
        existingNode.events = new Object();
        
      var regexpTokens = /[\w\:\.\$\!\\\'\"\?\[\]\-\(\)@%^&#+\/<>*~=,|]+/ig; //match (almost) any non space human readable character
      while (match = regexpTokens.exec(msgTokens)) //extract each token/value pair from the message and process it
      {
        // //V/VBAT/VOLTS is special, applies to whole node so save it as a node level metric instead of in the node metric collection
        // if (metricsDef.metrics.V.regexp.test(match[0]))
        // {
          // var tokenMatch = metricsDef.metrics.V.regexp.exec(match[0]);
          // existingNode.V = tokenMatch[1] || tokenMatch[0]; //extract the voltage part
          // continue;
        // }

        var matchingMetric;
        //try to match a metric definition
        for(var metric in metricsDef.metrics)
        {
          if (metricsDef.metrics[metric].regexp.test(match[0]))
          {
            //found matching metric, add/update the node with it
            //console.log('TOKEN MATCHED: ' + metricsDef.metrics[metric].regexp);
            var tokenMatch = metricsDef.metrics[metric].regexp.exec(match[0]);
            matchingMetric = metricsDef.metrics[metric];
            if (existingNode.metrics[matchingMetric.name] == null) existingNode.metrics[matchingMetric.name] = new Object();
            existingNode.metrics[matchingMetric.name].label = existingNode.metrics[matchingMetric.name].label || matchingMetric.name;
            existingNode.metrics[matchingMetric.name].descr = existingNode.metrics[matchingMetric.name].descr || matchingMetric.descr || undefined;
            existingNode.metrics[matchingMetric.name].value = metricsDef.determineValue(matchingMetric, tokenMatch);
            existingNode.metrics[matchingMetric.name].unit = matchingMetric.unit || undefined;
            existingNode.metrics[matchingMetric.name].updated = existingNode.updated;
            existingNode.metrics[matchingMetric.name].pin = existingNode.metrics[matchingMetric.name].pin != undefined ? existingNode.metrics[matchingMetric.name].pin : matchingMetric.pin;
            existingNode.metrics[matchingMetric.name].graph = existingNode.metrics[matchingMetric.name].graph != undefined ? existingNode.metrics[matchingMetric.name].graph : matchingMetric.graph;

            //log data for graphing purposes, keep labels as short as possible since this log will grow indefinitely and is not compacted like the node database
            if (existingNode.metrics[matchingMetric.name].graph==1)
            {
              var graphValue = matchingMetric.graphValue != undefined ? matchingMetric.graphValue : existingNode.metrics[matchingMetric.name].value;
              if (metricsDef.isNumeric(graphValue))
                dbLog.insert({ _id:(new Date().getTime()), n:id, m:matchingMetric.name, v:graphValue });
            }

            //console.log('TOKEN MATCHED OBJ:' + JSON.stringify(existingNode));
            break; //--> this stops matching as soon as 1 metric definition regex is matched on the data. You could keep trying to match more definitions and that would create multiple metrics from the same data token, but generally this is not desired behavior.
          }
        }
      }

      //prepare entry to save to DB, undefined values will not be saved, hence saving space
      var entry = {_id:id, updated:existingNode.updated, type:existingNode.type||undefined, label:existingNode.label||undefined, descr:existingNode.descr||undefined, hidden:existingNode.hidden||undefined, /*V:existingNode.V||undefined,*/ rssi:existingNode.rssi, metrics:Object.keys(existingNode.metrics).length > 0 ? existingNode.metrics : {}, events: Object.keys(existingNode.events).length > 0 ? existingNode.events : undefined };
      //console.log('UPDATING ENTRY: ' + JSON.stringify(entry));

      //save to DB
      db.findOne({_id:id}, function (err, doc) {
        if (doc == null)
        {
          db.insert(entry);
          console.log('   ['+id+'] DB-Insert new _id:' + id);
        }
        else
          db.update({ _id: id }, { $set : entry}, {}, function (err, numReplaced) { console.log('   ['+id+'] DB-Updates:' + numReplaced);});
      });
      
      //publish updated node to clients
      io.sockets.emit('UPDATENODE', entry);
      //handle any server side events (email, sms, custom actions)
      handleNodeEvents(entry);
    });
  }
  else
  {
    //console.log('no match: ' + data);
    dbunmatched.insert({_id:(new Date().getTime()), data:data});
  }
});

//keep track of scheduler based events - these need to be kept in sych with the UI - if UI removes an event, it needs to be cancelled from here as well; if UI adds a scheduled event it needs to be scheduled and added here also
scheduledEvents = []; //each entry should be defined like this: {nodeId, eventKey, timer}

//schedule and register a scheduled type event
function schedule(node, eventKey) {
  var nextRunTimeout = metricsDef.events[eventKey].nextSchedule(node);
  console.log('**** ADDING SCHEDULED EVENT - nodeId:' + node._id+' event:'+eventKey+' to run in ~' + (nextRunTimeout/3600000).toFixed(2) + 'hrs');
  var theTimer = setTimeout(runAndReschedule, nextRunTimeout, metricsDef.events[eventKey].scheduledExecute, node, eventKey); //http://www.w3schools.com/jsref/met_win_settimeout.asp
  scheduledEvents.push({nodeId:node._id, eventKey:eventKey, timer:theTimer}); //save nodeId, eventKey and timer (needs to be removed if the event is disabled/removed from the UI)
}

//run a scheduled event and reschedule it
function runAndReschedule(functionToExecute, node, eventKey) {
  functionToExecute(node, eventKey);
  schedule(node, eventKey);
}

//this runs once at startup: register scheduled events that are enabled
db.find({ events : { $exists: true } }, function (err, entries) {
  var count=0;
  
  for (var k in entries)
    for (var i in entries[k].events)
    {
      //console.log('Event for ' + JSON.stringify(entries[k].events) + ' : ' + metricsDef.events[i]);
      if (metricsDef.events[i] && metricsDef.events[i].nextSchedule && metricsDef.events[i].scheduledExecute)
      {
        schedule(entries[k], i);
        count++;
      }
    }
  //console.log('*** Events Register db count: ' + count);
});
  
//periodic function that will erase logged data older than 1 week
function dbLogRecycle() {
  var elapsed = new Date().getTime();
  console.log('Recycling dbLog ...');
  dbLog.remove({_id:{$lte: ((new Date().getTime())-604800000)}}, {multi:true}, function(err, count){ console.log('Removed '  + count + ' records'); }); //604800000ms = 1 week
  dbLog.persistence.compactDatafile();
  console.log('Recycling dbLog finished in ' + (new Date().getTime() - elapsed) + 'ms !');
  setTimeout(dbLogRecycle, 86400000); //run again in 24 hours
}

//86400000ms = 1 day
// var nextRun = new Date().setHours(3,0,0,0); //3am sharp
// nextRun = nextRun < new Date().getTime() ? (nextRun + 86400000) : nextRun;
// nextRun -= new Date().getTime();
var nextRunTimeout = metricsDef.timeoutOffset(3,0,0,0);
console.log('**** SCHEDULED dbLogRecycle to run in ~' + (nextRunTimeout/3600000).toFixed(2) + 'hrs');
setTimeout(dbLogRecycle, nextRunTimeout); //run at next 3am