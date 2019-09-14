// server.js
// where your node app starts

// init project
var fs = require('fs');
var https = require('https');
var express = require('express');
var bodyParser = require('body-parser');
var Twitter = require('twitter');
var compression = require('compression');
var md = require('md');

var app = express();
app.use(bodyParser.urlencoded({ extended: true }));
var nj = require('nunjucks');

nj.configure('views', {
    autoescape: true,
    express: app,
    noCache: true,
});

// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));
app.use(compression());

var BoardStore = require('./board_store.js');

// init sqlite db
var dbFile = './.data/sqlite.db';
var exists = fs.existsSync(dbFile);
var sqlite3 = require('sqlite3').verbose();
var Promise = require("bluebird");
Promise.promisifyAll(sqlite3)

var db = new sqlite3.Database(dbFile);

// if ./.data/sqlite.db does not exist, create it, otherwise print records to console
db.serialize(function(){
  if (!exists) {
    db.run('CREATE TABLE boards (id BIGINT, board TEXT, timestamp INTEGER, json TEXT, poll_data TEXT)');
    db.run('CREATE INDEX board_id ON boards (id)');
    db.run('CREATE TABLE poll_data (tweet_id BIGINT, timestamp INTEGER, poll_data TEXT)');
    db.run('CREATE INDEX tweet_timestamp ON poll_data(tweet_id, timestamp)');
    console.log('Tables created!');
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
const board_cache = './.data/board_cache.json';
const board_precache = './.data/board_precache.json';
const preload_boards = 10;

//========================
// User-facing pages
//========================

app.get("/:id(\\d+)?", function (request, response) {
  response.render(__dirname + '/views/index.html', {
    tweet_id: request.params.id,
    play_speed: request.query.play_speed,
  });
});

app.get("/stats", function (request, response) {
  response.render(__dirname + '/views/stats.html');
})

app.get("/updates", function(request, response) {
  fs.readFile(__dirname + '/CHANGELOG.md', (err, data) => {
    if(err) throw err;
    response.send(md(data.toString()));
  });
})


//========================
// Web client API methods
//========================

// Fetches a range of boards from the database
app.get("/boards", function (request, response) {
  console.log("Requesting boards...")
  let options = {
    limit: request.query.count || preload_boards,
    before: request.query.before,
    after: request.query.after,
    around: request.query.around,
    special: (request.query.special != undefined) ? true : false,
  }
  
  boards.getBoards(function(boards) {
    response.json(boards);
  }, options)
});

// Call to go fetch the latest tweets.
// I have my webserver just calling this from a cron job
app.get("/update", function (request, response) {
  boards.update({
    screen_name: 'emojitetra',
    count: 200,
  }, (resp) => {
    response.json(resp);
  })
});


app.get("/scores", function (request, response) {
  db.allAsync("SELECT timestamp, score FROM boards b LEFT JOIN board_meta bm ON b.id=bm.board_id WHERE is_board")
    .then(scores => response.json(scores.map(s => [s.timestamp, s.score])))
    .catch(err => response.json(err))
})

app.get("/votes", function(request, response) {
  console.log("Requesting votes...")
  db.allAsync("SELECT CAST(id AS TEXT) id, timestamp, poll_data FROM boards WHERE is_board ORDER BY timestamp DESC LIMIT 200")
    .then(polls => {
      console.log("Processing votes")
      let results = [];
      for(let p of polls) {
        let poll_json = JSON.parse(p.poll_data);
        if(!poll_json.counts_are_final) { continue; }
        let bits = {
          'label': [],
          'count': [],
        };
        for(let k in poll_json) {
          let match = k.match(/choice(\d+)_(\w+)/)
          if(match) {
            bits[match[2]][parseInt(match[1])] = poll_json[k]
          }
        }
        let votes = {}
        for(let idx in bits.label) {
          votes[bits.label[idx]] = bits.count[idx]         
        }
        results.push({
          id: p.id,
          timestamp: p.timestamp,
          votes: votes
        })
      }
      response.json(results);
    })
    .catch(err => response.json(err))
})


//========================
// Twitter auth endpoints
//========================


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

//=================================================
// Aaaand below lie a bunch of junk drawer methods
// which I use to maintain and debug stuff
//=================================================

/*
sqlite> .schema
CREATE TABLE boards (id BIGINT, board TEXT, timestamp INTEGER, json TEXT, poll_data TEXT, is_board INTEGER);
CREATE TABLE "sampled_data" (tweet_id BIGINT, timestamp INTEGER, poll_data TEXT, retweets INT, likes INT);
CREATE UNIQUE INDEX board_id ON boards(id);
CREATE UNIQUE INDEX tweet_timestamp ON "sampled_data"(tweet_id, timestamp);
CREATE TABLE board_meta(board_id BIGINT, prev_id INT, prev_board_id INT, score INT, role INT, replies INT, retweets INT, likes INT);
CREATE UNIQUE INDEX meta_id ON board_meta(board_id);
CREATE UNIQUE INDEX poll_unique ON "sampled_data"(tweet_id, timestamp);
*/

app.get("/check", function(request, response) {


  let query = "SELECT CAST(id AS TEXT) id_str, board, CAST(reply_id AS STRING) reply_id, CAST(quoted_id AS STRING) quoted_id, CAST(prev_board_id AS STRING) prev_board_id, role, timestamp, score FROM boards b LEFT JOIN board_meta bm ON bm.board_id=b.id ORDER BY id DESC";
  if(request.query.limit) { query += " LIMIT " + parseInt(request.query.limit) }
  db.allAsync(query).then((boards) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', });
    response.write(`
      <style>
        body { width: 200%; overflow-x: scroll; }
        .board { width: 10px; height: 10px; border: 1px solid black; }
      </style>
    `);


    let expected = {};
    let ref_icons = ['↛','→','⇒','⇛','↠','⤀','⤁'];
    let prev_day;
    console.log(boards[0])
    for(let b of boards) {
      let tweet_time = new Date(b.timestamp*1000);
      if(tweet_time.getDate() != prev_day) { response.write("<br/>" + tweet_time.getFullYear() + '-' + (tweet_time.getMonth() + 1) + '-' + tweet_time.getDate()); }
      prev_day = tweet_time.getDate();

      let num_refs = 0;
      for(let type in expected) {
        if(b.id_str == expected[type]) {
          expected_type = null;
          num_refs++;
        }
      }
      let ref = ref_icons[num_refs];

      if(b.board.indexOf("◽") > -1) {
        if(b.board.indexOf("+") > -1) {
          board_char = "💥";
          link = 'https://twitter.com/EmojiTetra/status/' + b.id_str;
        } else {
          board_char = "◼";
          link = '/' + b.id_str ;
        }

        response.write(ref + '<a href="' + link + '" style="color:rgb(0,' + b.score/500 + ',0)">' + board_char + '</a>');

        expected['prev'] = b.reply_id;
      } else if(b.board.indexOf("Game continues") == 0) {
        response.write(ref + '<a href="https://twitter.com/EmojiTetra/status/' + b.id_str + '">◉</a>');

        expected['continues_reply'] = b.reply_id;
        expected['continues_quote'] = b.quoted_id;
      } else if(b.board.indexOf("Continuing game") == 0) {
        response.write(ref + '<a href="https://twitter.com/EmojiTetra/status/' + b.id_str + '">○</a>');

        expected['continuing_quote'] = b.quoted_id;
      } else {
        response.write('<a href="https://twitter.com/EmojiTetra/status/' + b.id_str + '">📄</a>');
      }
    }
    response.end();
  }).catch(e => {
    console.log(e);
    response.send(e);
  });
})

app.get("/check.json", function(request, response) {
  let query = "SELECT CAST(id AS TEXT) id_str, CAST(prev_id AS STRING) prev_id, CAST(prev_board_id AS STRING) prev_board_id, role, timestamp FROM boards b LEFT JOIN board_meta bm ON bm.board_id=b.id ORDER BY id DESC";
  if(request.query.limit) { query += " LIMIT " + parseInt(request.query.limit) }
  db.allAsync(query).then(boards => response.json(boards))
})

app.get("/fill", function(request, response) {
  boards.fillMissing();
  response.send("Off it goes!")
})

app.get("/fetch/:start/:end", function(request, response) {
  boards.getTweets(request.params.start, request.params.end, [], {
    screen_name: 'emojitetra',
    count: 200,
  }, function(err, resp) {
    console.log(resp);
    if(err) { response.send("Error: " + err); }
    else { response.send('<a href="/fetch/' + resp.continue.join('/') + '">Continue</a>') }
  });
})

app.get("/fetch/:id", function(request, response) {
  let ids = request.params.id.split(',');
  let promises = [];
  for(let id of ids) {
    promises.push(boards.getDetails(id).then(fulltweet => {
      return boards.storeTweet(fulltweet, request.query.exists);
    }))
  }
  Promise.all(promises.map(p => {
    return p.then(res => res, err => err)
  })).then(all => {
    response.json(all);
  })
})

app.get("/fetch_thread/:id", function(request, response) {
  boards.getThread(request.params.id, request.query.count).then(resp => { 
    let params = (request.query.count) ? '?count=' + request.query.count : '';
    response.send('Added ' + resp.total + ' tweets. <a href="/fetch/' + resp.next + params + '">Continue?</a>') 
  }).catch(err => {
    response.status(500);
    response.json(err);
  })
})

app.get("/details/:id", function (request, response) {
  // Card example: https://gist.github.com/fourtonfish/816c5272c3480c7d0e102b393f60bd49
  var res = boards.getDetails(request.params.id).then((tweet) => {
    response.json(tweet);
  }).catch((err) => {
    response.json(err);
  })
});

app.get("/search", function(request, response) {
  boards.findOtherTweets().then(cnt => response.send("Found " + cnt + " results"))
})

app.get("/gen_meta/:id", function(request, response) {
  boards.updateMeta(request.params.id)
    .then((blarp) => {
      console.log(blarp);
      return db.getAsync("SELECT * FROM board_meta WHERE board_id = ?", request.params.id)
    })
    .then(meta => { response.json(meta); })
    .catch(err => { response.json(err); })
})

app.get("/fill_meta/:count", (request, response) => {
  let query = 'INSERT INTO board_meta ' +
    'SELECT id,' +
    'COALESCE(' +
      'json_extract(json, "$.in_reply_to_status_id_str"),' +
      'json_extract(json, "$.quoted_status_id_str")' +
    ') prev_id,' +
    'json_extract(json, "$.in_reply_to_status_id_str") reply_id,' +
    'json_extract(json, "$.quoted_status_id_str") quoted_id,' +
    '(SELECT id FROM boards WHERE timestamp < b.timestamp AND is_board ORDER BY timestamp DESC LIMIT 1) prev_board_id,' +
    'NULL score,' +
    'NULL role,' +
    'NULL replies,' +
    'json_extract(json, "$.retweet_count"),' +
    'json_extract(json, "$.favorite_count") ' +
    'FROM boards b LEFT JOIN board_meta bm ON b.id = bm.board_id '+
    'WHERE bm.board_id IS NULL ' +
    'LIMIT ' + parseInt(request.params.count);
  db.run(query, function(err) {
    response.json({query: query, err: err, rows: this.count}) 
  });
})

app.get("/calculate_meta/:tweet_id?", (request, response) => {
  boards.calculateMeta(request.params.tweet_id, request.query.count)
    .then(resp => response.json(resp))
})

// listen for requests :)
var listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
