// server.js
// where your node app starts

// init project
var express = require('express');
var bodyParser = require('body-parser');
var Twitter = require('twitter');
var app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

// init sqlite db
var fs = require('fs');
var dbFile = './.data/sqlite.db';
var exists = fs.existsSync(dbFile);
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(dbFile);

// if ./.data/sqlite.db does not exist, create it, otherwise print records to console
db.serialize(function(){
  if (!exists) {
    db.run('CREATE TABLE boards (id BIGINT, board TEXT, timestamp INTEGER, json TEXT)');
    console.log('New table boards created!');
  }
});

// init Twitter
var client = new Twitter({
  consumer_key: process.env.TWITTER_KEY,
  consumer_secret: process.env.TWITTER_SECRET,
  access_token_key: process.env.MY_TOKEN,
  access_token_secret: process.env.MY_SECRET
});

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", function (request, response) {
  db.all("SELECT id, board, timestamp FROM boards ORDER BY timestamp DESC", function(err, rows) {
    response.json(rows)
  })
});

app.get("/update", function (request, response) {
  var params = {screen_name: 'emojitetra'};
  console.log("Getting tweets...");
  client.get('statuses/user_timeline', params, function(error, tweets, twitter_response) {
    if (!error) {
      var last_tweet = db.get("SELECT * FROM boards ORDER BY timestamp DESC LIMIT 1");
      var last_timestamp = Date(last_tweet.timestamp);
      console.log("Getting tweets from after " + last_timestamp);
      var num_tweets = 0
      for(var tweet of tweets) {
        var tweet_timestamp = Date.parse(tweet.created_at);
        console.log("Tweet timestamp: " + tweet_timestamp);
        console.log("Last timestamp: " + last_timestamp);
        if(tweet_timestamp <= last_tweet.timestamp) {
          console.log("Got all new tweets!");
          break;
        }
        db.run("INSERT INTO boards VALUES(?,?,?,?)",tweet.id,tweet.text,tweet_timestamp,JSON.stringify(tweet))
        num_tweets++;
      }
      response.send("Added " + num_tweets + " tweets")
   }
 else {
      console.log(error);
      response.json({"Twitter API Error": error});
    }  });
  //response.sendFile(__dirname + '/views/index.html');
});

app.get("/auth", function (request, response) {
  response.sendFile(__dirname + '/views/index.html');
});

// endpoint to get all the dreams in the database
// currently this is the only endpoint, ie. adding dreams won't update the database
// read the sqlite3 module docs and try to add your own! https://www.npmjs.com/package/sqlite3
app.get('/getDreams', function(request, response) {
  db.all('SELECT * from Dreams', function(err, rows) {
    response.send(JSON.stringify(rows));
  });
});

// listen for requests :)
var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
;