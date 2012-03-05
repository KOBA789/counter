var http = require('http'),
    fs = require('fs'),
    url = require('url'),
    crypto = require('crypto');

var redis = require("redis"),
    client = redis.createClient();

var uuid = require('node-uuid');

var hogan = require("hogan.js");

var keys = {};
keys.first = 'e79707c4846348018a9a070ad1b041d4';
keys.second = 'a3059b28799a4640bc1b1dc50a979502';

var files = {};
files.index = fs.readFileSync('./public/index.html');
files.manage = fs.readFileSync('./public/manage.html', 'utf-8');

var templates = {};
// templates.index = hogan.compile(files.index);
templates.manage = hogan.compile(files.manage);

function getHash(str, key) {
  var hmac = crypto.createHmac('sha1', key);
  hmac.update(str);
  return hmac.digest('hex');
}

var app = http.createServer(handler);

app.listen(8124);

function handler (req, res) {
  var reqUrl = {};
  var pathname = '';
  try {    
    reqUrl = url.parse(req.url, true);
    pathname = reqUrl.pathname;
  } catch (x) {
    return;
  }
  var isParseError = false, rawId = '';
  try {
    rawId = reqUrl.query.id;
  } catch (x) {
    isParseError = true;
  }

  switch (pathname) {
  case '/':
  case '/index.html':
    res.writeHead(200, {
      'Content-Length': files.index.length,
      'Content-Type': 'text/html'
    });
    res.end(files.index);
    break;
  case '/manage':
    var hiddenId = getHash(rawId, keys.first);
    var publicId = getHash(hiddenId, keys.second);

    if (isParseError) {
      res.end('Invalid counter id. [code 01]');
    }
    if (!publicId.match(/[a-z0-9]{40}/)) {
      res.end('Invalid counter id. [code 02]');
    }

    client.get(publicId, function (err, counterValue) {
      if (err) {
        res.end('Invalid counter id. [code 03]');
        return;
      }
      if (counterValue === null ||
          !String(rawId).match(/[0-9]+/)) {
        res.end('Invalid counter id. [code 04]');
        return;
      }
      var html = templates.manage.render({
        rawId: rawId,
        publicId: publicId,
        hiddenId: hiddenId,
        counterValue: counterValue
      });
      res.writeHead(200, {
        'Content-Length': new Buffer(html).length,
        'Content-Type': 'text/html'
      });
      res.end(html);
    });
    break;
  default:
    res.writeHead(404);
    res.end('404');
  }
}