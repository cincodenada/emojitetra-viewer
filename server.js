// server.js
// where your node app starts

// init project
var fs = require('fs');
var https = require('https');
var express = require('express');
var bodyParser = require('body-parser');
var Twitter = require('twitter');
var app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

var BoardStore = require('./board_store.js');

// init sqlite db
var dbFile = './.data/sqlite.db';
var exists = fs.existsSync(dbFile);
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(dbFile);

// if ./.data/sqlite.db does not exist, create it, otherwise print records to console
db.serialize(function(){
  if (!exists) {
    db.run('CREATE TABLE boards (id BIGINT, board TEXT, timestamp INTEGER, json TEXT, poll_data TEXT)');
    console.log('New table boards created!');
  }
});

// init Twitter
// Uses the following publically-available keys for Twitter for iPhone:
//TWITTER_KEY=IQKbtAYlXLripLGPWd0HUA
//TWITTER_SECRET=GgDYlkSvaPxGxC4X8liwpUoqKwwr3lCADbz8A7ADU
var token = JSON.parse(fs.readFileSync('./.data/token.json'))
var client = new Twitter({
  consumer_key: process.env.TWITTER_KEY,
  consumer_secret: process.env.TWITTER_SECRET,
  bearer_token: token.access_token,
});

// init BoardStore
var boards = new BoardStore(db, client);

// http://expressjs.com/en/starter/basic-routing.html
app.get("/boards", function (request, response) {
  db.all("SELECT id, board, timestamp, poll_data FROM boards ORDER BY timestamp DESC", function(err, rows) {
    for(var r of rows) {
      var parsed = JSON.parse(r.poll_data);
      if(parsed) {
        var results = {}
        for(var key of Object.keys(parsed)) {
          if(key.substr(-5) == 'label') {
            results[parsed[key]] = parsed[key.replace("_label","_count")];
          }
        }
        r.poll_data = results;
      }
    }
    response.json(rows)
  })
});

app.get("/update", function (request, response) {
  // Card example: https://gist.github.com/fourtonfish/816c5272c3480c7d0e102b393f60bd49
  var res = boards.update({
    screen_name: 'emojitetra',
    count: 200,
  }, (resp) => {
    response.send(resp);                     
  })
});


app.get("/details/:id", function (request, response) {
  // Card example: https://gist.github.com/fourtonfish/816c5272c3480c7d0e102b393f60bd49
  var res = boards.getDetails(request.params.id, (tweet) => {
    response.json(tweet);
  })
});

app.get("/invalidate", function(request, response) {
  let body = 'access_token=' + token.access_token;
  let auth = Buffer(process.env.TWITTER_KEY + ":" + process.env.TWITTER_SECRET);
  let authRequest = https.request({
    hostname: 'api.twitter.com',
    path: '/oauth2/invalidate_token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': 'Basic ' + auth.toString('base64'),
    }
  }, (res) => {
    console.log("Got response...");
    let data = ""
    res.setEncoding('utf8');
    res.on('data', (chunk) => { data += chunk });
    res.on('end', () => {
        response.send(data)
    });
  });
  console.log("Requesting Twitter Auth...");
  authRequest.write(body);
  authRequest.end();
  console.log("Requested Twitter Auth...");
})

app.get("/auth", function (request, response) {
  let body = 'grant_type=client_credentials';
  let auth = Buffer(process.env.TWITTER_KEY + ":" + process.env.TWITTER_SECRET);
  let authRequest = https.request({
    hostname: 'api.twitter.com',
    path: '/oauth2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': 'Basic ' + auth.toString('base64'),
    }
  }, (res) => {
    console.log("Got response...");
    let data = ""
    res.setEncoding('utf8');
    res.on('data', (chunk) => { data += chunk });
    res.on('end', () => {
      console.log("Finished response...");
      fs.writeFile('./.data/token.json', data, (err) => {
        if(err) {
          console.log("Error saving token: " + err.code);
          response.send(JSON.stringify(err));
        } else {
          response.send(data)
        }
      })
    });
  });
  console.log("Requesting Twitter Auth...");
  authRequest.write('grant_type=client_credentials');
  authRequest.end();
  console.log("Requested Twitter Auth...");
});


app.get("/", function (request, response) {
  response.sendFile(__dirname + '/views/index.html');
});

// listen for requests :)
var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});