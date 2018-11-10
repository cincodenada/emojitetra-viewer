var BigInt = require("big-integer");

module.exports = class BoardStore {
  constructor(db, twitter) { 
    this.db = db; 
    this.twitter = twitter;
  }
  
  update(params, cb) {
    var last_id = null;
    var backfill = params.backfill;
    delete params.backfill;
    if(!backfill) {
      this.db.all("SELECT CAST(id AS TEXT) as id, timestamp FROM boards ORDER BY timestamp DESC LIMIT 5", (err, recent_tweets) => {
        if(err) { console.err("Couldn't get recent tweets: " + err); }

        var existing_tweets = [];
        if(recent_tweets) {
          var last_tweet = recent_tweets[recent_tweets.length-1];
          var last_timestamp = new Date(last_tweet.timestamp);
          existing_tweets = recent_tweets.map(t => t.id);
          last_id = BigInt(last_tweet.id).subtract(1).toString();
          console.log("Updating tweets from after " + last_tweet.id + " @ " + last_timestamp);
        } else {
          console.log("Getting all tweets");
          return;
        }

        this.getTweets(last_id, null, existing_tweets, params, (err, num_tweets) => {
          if(err) {
            cb({"error": err});
          } else {
            cb({"num_tweets": num_tweets});
          }
        })
      })
    } else {
      this.db.get("SELECT CAST(id AS TEXT) as id, timestamp FROM boards ORDER BY timestamp ASC LIMIT 1", (err, first_tweet) => {
        if(err) { console.err("Couldn't get last tweet: " + err); }

        if(first_tweet) {
          var first_timestamp = new Date(first_tweet.timestamp);
          var first_id = first_tweet.id;
          console.log("Getting tweets from before " + first_tweet.id + " @ " + first_timestamp);
          this.getTweets(null, first_id, params, (err, num_tweets) => {
            if(err) {
              cb({"error": err});
            } else {
              cb(num_tweets);
            }
          })
        } else {
          console.log("Bad tweet?")
          console.log(first_tweet)
        }
      })

    }
  }
  
  getTweets(from_id, to_id, existing_tweets, params, cb, self, tweet_counts, depth) {
    if(!depth) { depth = 0; }
    if(!self) { self = this; }
    if(!tweet_counts) { tweet_counts = {"total": 0, "new": 0}; }
    
    // For if things start getting out of hand
    //console.log("Depth: " + depth);
    //if(depth > 3) { console.log("Bailing!"); return; }
    
    console.log("Getting tweets from " + from_id + " to "  + to_id + "...");
    if(to_id) {
      to_id = BigInt(to_id);
      params['max_id'] = to_id.toString(); 
    }
    if(from_id) {
      from_id = BigInt(from_id);
      params['since_id'] = from_id.toString();
    }
    console.log(JSON.stringify(params))
    self.twitter.get('statuses/user_timeline', params, function(error, tweets, twitter_response) {
      if (!error && twitter_response.statusCode == 200) {
        var num_tweets = 0;
        var updated = 0;
        var last_tweet_id = null;
        for(var tweet of tweets) {
          var cur_id = BigInt(tweet.id_str)
          var tweet_timestamp = new Date(tweet.created_at);
          console.log("Current tweet: " + tweet.id_str + " @ " + tweet_timestamp);
          
          var exists = existing_tweets &&
            (existing_tweets.indexOf(tweet.id_str) > -1);
          
          // If we hit our last tweet, dump out
          if(from_id && cur_id <= from_id) {
            console.log("Got all new tweets!");
            tweet_counts.total += num_tweets;
            tweet_counts.new += (num_tweets - updated);
            cb(null, tweet_counts);
            return;
          }
          self.getDetails(tweet.id_str, (fulltweet) => {
            self.storeTweet(fulltweet, exists);
          })
          num_tweets++;
          if(exists) { updated++; }
          last_tweet_id = tweet.id_str;
        }
        console.log(last_tweet_id);
        console.log(from_id.toString());

        tweet_counts.total += num_tweets;
        tweet_counts.new += (num_tweets - updated);
        // Don't unconditionally go backwards yet
        if(num_tweets && from_id) {
          // Down the rabbit hole, time to get more...
          self.getTweets(from_id.toString(), last_tweet_id, existing_tweets, params, cb, self, tweet_counts, depth+1);
        } else {
          cb(null, tweet_counts)
        }
      } else {
        if(error) {
          cb(error);
        } else {
          cb({"statusCode": twitter_response.statusCode});
        }
      }
    });
  }
  
  getDetails(tweet_id, cb) {
    var params = {
      'include_cards': 1,
      'cards_platform': 'iPhone-13',
    };
    this.twitter.get('statuses/show/' + tweet_id + '.json', params, function(error, tweets, twitter_response) {
      cb(tweets)
    });
  }
  
  storeTweet(tweet, exists) {
    var tweet_timestamp = new Date(tweet.created_at);
    var poll_data = {}
    if(tweet.card) {
      for(var key of Object.keys(tweet.card.binding_values)) {
        var val = tweet.card.binding_values[key];
        switch(val.type) {
          case 'STRING':
            poll_data[key] = val.string_value;
            break;
          case 'BOOLEAN':
            poll_data[key] = val.boolean_value;
            break;
        }
      }
    }
    var poll_updated = new Date(poll_data.last_updated_datetime_utc);
    var poll_json = JSON.stringify(poll_data);
    var tweet_json = JSON.stringify(tweet);
    
    if(exists) {
      // Scope nonsense
      var db = this.db;
      // Check if we have new data, and if so update the tweet and add it to the poll_data table
      db.get("SELECT MAX(timestamp) AS recent FROM poll_data WHERE tweet_id = ?",tweet.id_str,function(err, timestamp) {
        if(timestamp.recent < poll_updated.getTime()) {
          console.log("Updating tweet " + tweet.id_str);
          db.run("UPDATE boards SET poll_data = ? WHERE id = ?",poll_json,tweet.id_str);
          db.run("INSERT INTO poll_data VALUES(?,?,?)",tweet.id_str,poll_updated.getTime(),poll_json)
        }
      })
    } else {
      console.log("Saving tweet " + tweet.id_str);
      this.db.run("INSERT INTO boards VALUES(?,?,?,?,?)",tweet.id_str,tweet.text,tweet_timestamp.getTime(),tweet_json,poll_json);
      this.db.run("INSERT INTO poll_data VALUES(?,?,?)",tweet.id_str,poll_updated.getTime(),poll_json)
    }
    return true;
  }
  
  getBoards(cb, opts) {
    var opts = opts || {}
    var limit = opts.limit || 50000; // Disable for now
    var order = order || -1;
    
    var where = [], params = {};
    if(opts.newest) {
      where.push("id < $newest");
      params['$newest'] = opts.newest;
    }
    if(opts.oldest) {
      where.push("id > $oldest");
      params['$oldest'] = opts.oldest;
    }
    //params['$limit'] = parseInt(limit);
    
    var limit_int = parseInt(limit);
    var order_str = (order > 0 ? "ASC" : "DESC");
    var where_str = "";
    if(where.length) { where_str = "WHERE " + where.join(" AND ") }
    var query = "SELECT CAST(id AS TEXT) as id, board, timestamp, poll_data FROM boards " +
        where_str + " ORDER BY timestamp " + order_str + " LIMIT " + limit_int; 
    
    this.db.all(query, params, function(err, rows) {
      if(err) { console.log(err) }
      var boards = [];
      for(var r of rows) {
        var cur_board = new Board(r);
        if(opts.include_meta || cur_board.score !== null) { boards.push(cur_board) };
      }
      cb(boards)
    })
  }
  
  getRaw(cb) {
    this.db.all("SELECT json FROM boards ORDER BY id DESC LIMIT 200", function(err, rows) {
      if(err) { console.log(err) }
      var output = "";
      var last_reply = "";
      for(var r of rows) {
        var parsed = JSON.parse(r.json)
        if(parsed.text.indexOf("◽") > -1) {
          if(last_reply && parsed.id_str == last_reply) { output += "✔️" }
          output += '<a href="https://twitter.com/EmojiTetra/status/' + parsed.id_str + '">Board ' + parsed.created_at + '</a><br/>\n';
          last_reply = parsed.in_reply_to_status_id_str;
        } else if(parsed.text.indexOf("new thread") > -1) {
          output += '<a href="https://twitter.com/EmojiTetra/status/' + parsed.id_str + '">Continuation ' + parsed.created_at + '</a><br/>\n';
        } else {
          output += '<a href="https://twitter.com/EmojiTetra/status/' + parsed.id_str + '">Other: ' + parsed.text + ' @ ' + parsed.created_at + '</a><br/>\n';          
        }
      }
      cb(output)
    })
  }
}

const board_re = [
  RegExp('^(\\d\\S+)'),
  RegExp('Score (\\d+)'),
  RegExp('Score\n.*(\\d+)'),
]

class Board {
  constructor(board_info) {
    this.board = board_info.board;
    this.id = BigInt(board_info.id);
    this.timestamp = board_info.timestamp;
    this.parsePoll(board_info.poll_data);
    this.parseScore()
  }
  
  parsePoll(poll_json) {
    var parsed = JSON.parse(poll_json);
    if(parsed) {
      var results = {};
      for(var key of Object.keys(parsed)) {
        if(key.substr(-5) == 'label') {
          var label = parsed[key];
          results[label] = parsed[key.replace("_label","_count")];
        }
      }
      this.poll_data = results;
    }
  }
  
  parseScore() {
    this.score = null;
    for(var idx in board_re) {
      var re = board_re[idx];
      var matches = re.exec(this.board);
      if(matches) {
        this.score = parseInt(matches[1].replace(/\D/g,""));
      }
    }
    if(this.score === null) {
      console.log(this.board)
    }
  }
}