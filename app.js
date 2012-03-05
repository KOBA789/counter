var http = require('http'),
    fs = require('fs'),
    url = require('url'),
    crypto = require('crypto');

var router = new (require('router-line').Router);
var cookie = require('cookie-line');
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

function genRawId() {
  return uuid.v4().split('-').join('');
}

function getPublicId(rawId) {
  return getHash(rawId, keys.first);
}

function getHiddenId(publicId) {
  return getHash(publicId, keys.second);
}

function validRawId(id) {
  if (typeof id !== 'string') {
    return false;
  }
  return id.match(/[a-f0-9]{32}/);
}

function validHiddenId(id) {
  if (typeof id !== 'string') {
    return false;
  }
  return id.match(/[a-f0-9]{40}/);
}

function validPublicId(id) {
  if (typeof id !== 'string') {
    return false;
  }
  return id.match(/[a-f0-9]{40}/);  
}

function validCounterValue(num) {
  if (typeof num !== 'string') {
    return false;
  }
  return num.match(/[0-9]+/);
}

function writeError(res, code) {
  res.writeHead(200, {
    'Content-Type': 'text/plain'
  });  
  res.end('[Error] code: ' + code);
}

function writeJs(res, code) {
  res.writeHead(200, {
    'Content-Type': 'text/javascript'
  });
  res.end(code);
}

function writeVoid0(res) {
  writeJs(res, 'void(0);');
}

function writeJson(res, json) {
  res.writeHead(200, {
    'Content-Type': 'application/json'
  });
  res.end(json);
}

function getTomorrow() {
  return new Date(Math.floor((new Date) / 86400000) * 86400000 + 86400000);
}

function isObject(obj) {
  return typeof obj === 'object' && obj !== null;
}

function index() {
  var res = this.response;
  res.writeHead(200, {
    'Content-Length': files.index.length,
    'Content-Type': 'text/html'
  });
  res.end(files.index);
}

function manage() {
  var rawId = this.params['id'];
  var res = this.response;
  if (validRawId(rawId)) {
    var publicId = getPublicId(rawId);
    var hiddenId = getHiddenId(publicId);
    client.get('cv-' + hiddenId, function (err, counterValue) {
      if (err) {
        writeError(res, '02');
        return;
      }
      if (!validCounterValue(counterValue)) { 
        writeError(res, '03');
        return;
      }
      
      var html = templates.manage.render({
        rawId: rawId,
        publicId: publicId,
        hiddenId: hiddenId,
        counterValue: counterValue
      });
      res.writeHead(200, {
        // 'Content-Length': new Buffer(html).length,
        'Content-Type': 'text/html'
      });
      res.end(html);
    });
  } else {
    writeError(this.res, '01');
  }
}

function create() {
  var res = this.response;
  var rawId = genRawId();
  var publicId = getPublicId(rawId);
  var hiddenId = getHiddenId(publicId);

  client.set('cv-' + hiddenId, '0', function (err) {
    if (err) {
      writeError(res, '04');
      return;
    }
    client.set('ip-' + hiddenId, '0.0.0.0', function (err) {
      if (err) {
        writeError(res, '05');
        return;
      }
      res.writeHead(302, {
        'Location': '/manage/' + rawId
      });
      res.end();
    });
  });
}

function countUp(hiddenId, isAlready, callback) {
  client.get('cv-' + hiddenId, function (err, counterValue) {
    if (err) {
      callback(err, null);
      return;
    }
    
    if (!validCounterValue(counterValue)) { 
      callback(new Error('counter value is invalid'), null);
      return;
    }
    
    if (isAlready) {
      callback(null, counterValue);
      return;
    }
    
    client.incr('cv-' + hiddenId, function (err, counterValue2) {
      counterValue2 = String(counterValue2)
        || String(Number(counterValue) + 1);

      if (err) {
        callback(err, null);
        return;
      }
      
      if (!validCounterValue(counterValue2)) { 
        callback(new Error('counter value is invalid'), null);
        return;
      }

      callback(null, counterValue2);
    });
  });
}

function hidden() {
  var res = this.response, cookies = this.cookies;

  var hiddenId = this.params['id'];
  if (!validHiddenId(hiddenId)) {
    writeVoid0(res);
    return;
  }

  var isAlready = !!this.cookies.get('hd-' + hiddenId);

  countUp(hiddenId, isAlready, function (err, counterValue) {
    if (err) {
      writeVoid0(res);
      return;
    }

    cookies.set('hd-' + hiddenId, '1', {
      path: '/',
      expires: getTomorrow().toUTCString()
    });

    writeVoid0(res);
  });
}

function normal() {
  var res = this.response, cookies = this.cookies,
      params = this.params;
  var publicId = params['id'];
  if (!validPublicId(publicId)) {
    writeVoid0(res);
    return;
  }

  var hiddenId = getHiddenId(publicId);
  if (!validHiddenId(hiddenId)) {
    writeVoid0(res);
    return;
  }

  var isAlready = !!this.cookies.get('pb-' + hiddenId);

  countUp(hiddenId, isAlready, function (err, counterValue) {
    if (err) {
      writeVoid0(res);
      return;
    }

    cookies.set('pb-' + hiddenId, '1', {
      path: '/',
      expires: getTomorrow().toUTCString()
    });

    var json = '{"value":' + counterValue + '}';
    
    if (params['callback']) {
      var callback = params['callback'];
      if (typeof callback === 'string'
          && callback.match(/[a-z_][a-zA-Z0-9_]*/)) {
        writeJs(res, callback + '(' + json + ');');
      }
    } else {
      writeJson(res, json);
    }
  });
}

router.GET('/', index);
router.GET('/index.html', index);
router.POST('/create', create);
router.GET('/manage/:id', manage);
router.GET('/hidden/:id', hidden);
router.GET('/normal/:id', normal);

function Helper(req, res, params) {
  this.request = req;
  this.response = res;
  this.params = params;
  this.cookies = cookie(req, res);
  var parsedUrl = url.parse(this.request.url, true);
  if (isObject(parsedUrl) && isObject(parsedUrl.query)) {
    for (var key in parsedUrl.query) {
      this.params[key] = parsedUrl.query[key];
    }
  }
}

var app = http.createServer(function (req, res) {
  var reqUrl = url.parse(req.url);
  var result = router.route(req.method.toUpperCase(),
                            reqUrl.pathname);
  if (result === undefined) {
    res.writeHead(404);
    res.end();
    return;
  }
  var handler = new Helper(req, res, result.params);
  result.value.call(handler);
});

app.listen(8124);