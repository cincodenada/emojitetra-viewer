var BigInt = require("big-integer");

function parse_score(board) {  
  const board_re = [
    RegExp('Score\n\\D+(\\d+)'),
    RegExp('Score (\\d+)'),
    RegExp('^(\\d\\S+)'),
  ]
  
  for(var idx in board_re) {
    var re = board_re[idx];
    var matches = re.exec(this.board);
    if(matches) {
      return parseInt(matches[1].replace(/\D/g,""));
    }
  }
  
  return null;
}

class Board {
  constructor(board_info) {
    this.board = board_info.board;
    this.id = BigInt(board_info.id);
    this.timestamp = board_info.timestamp;
    this.parsePoll(board_info.poll_data);
    this.score = parse_score(this.board);
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
      this.poll_finished = parsed.counts_are_final;
    }
  }
}

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
          if(tweet_counts.total > 50) {
            cb(null, {"continue": [from_id.toString(), last_tweet_id]})
          } else {
            // Down the rabbit hole, time to get more...
            self.getTweets(from_id.toString(), last_tweet_id, existing_tweets, params, cb, self, tweet_counts, depth+1);
          }
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
    console.log("Storing tweet " + tweet.id_str)
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
    
    let self = this;
    if(exists) {
      // Scope nonsense
      console.log("Checking for recency...");
      // Check if we have new data, and if so update the tweet and add it to the poll_data table
      self.db.get("SELECT MAX(timestamp) AS recent FROM poll_data WHERE tweet_id = ?",tweet.id_str,function(err, timestamp) {
        console.log(timestamp.recent)
        console.log(poll_updated.getTime())
        if(timestamp.recent < poll_updated.getTime()) {
          console.log("Updating tweet " + tweet.id_str);
          self.db.run("UPDATE boards SET poll_data = ? WHERE id = ?",poll_json,tweet.id_str);
          self.db.run("INSERT INTO poll_data VALUES(?,?,?)",tweet.id_str,poll_updated.getTime(),poll_json)
        } else {
          self.db.get("SELECT COUNT(*) as cnt FROM boards WHERE id = ?",tweet.id_str,function(err, data) {
            if(data.cnt == 0) {
              // I don't know how we get here, hopefully it's transient
              self.db.run("INSERT INTO boards VALUES(?,?,?,?,?)",tweet.id_str,tweet.text,tweet_timestamp.getTime(),tweet_json,poll_json,(err) => {
                console.log("Inserted board")
                console.log(err)
              });
            }
          })
        }
      })
    } else {
      console.log("Saving tweet " + tweet.id_str);
      self.db.run("INSERT INTO boards VALUES(?,?,?,?,?)",tweet.id_str,tweet.text,tweet_timestamp.getTime(),tweet_json,poll_json, (err) => {
        if(err) { console.log("Couldn't save tweet: " + err); }
        this.updateMeta(tweet.id_str);        
      });
      self.db.run("INSERT INTO poll_data VALUES(?,?,?)",tweet.id_str,poll_updated.getTime(),poll_json, (err) => {
        if(err) { console.log("Couldn't save poll data: " + err); }
      })
    }
    
    return true;
  }
  
  fillMissing() {
    let fetched = [];
    let self = this;
    this.db.each('SELECT json_extract(b.json, "$.in_reply_to_status_id_str") AS prev_id FROM boards b ' +
                 'LEFT JOIN boards b2 ON b2.id = prev_id ' +
                 'WHERE b2.id IS NULL AND prev_id != "" LIMIT 10', function(err, row) {
      if(!err) {
        console.log(row);
        self.getDetails(row.prev_id, (fulltweet) => {
          self.storeTweet(fulltweet, false);
          console.log("Recovering " + row.prev_id);
        })
      }
    });
  }
  
  updateMeta(tweet_id) {
    let self = this;
    self.db.get('SELECT CAST(id AS STRING) id, board,' +
                'json_extract(json, "$.in_reply_to_status_id_str") prev_id,' +
                'json_extract(json, "$.retweet_count") retweets,' +
                'json_extract(json, "$.favorite_count") favorites,' +
                'board LIKE "%🇬 🇦 🇲 🇪%🇴 🇻 🇪 🇷%" AS is_end ' +
                'FROM boards WHERE id=?',tweet_id, (err, board_info) => {
      if(err) {
        console.log("Error updating meta for " + tweet_id);
        return;
      }
      // Look up to three boards back for the previous *board
      let get_prev = function(board_id, cb, depth) {
        if(!depth) { depth = 0; }
        if(depth > 3) { cb("Board not found!", null, null); }

        self.db.get('SELECT board, (board LIKE "%◽%") AS is_board, board LIKE "%🇬 🇦 🇲 🇪%🇴 🇻 🇪 🇷%" AS is_end,' +
                    'json_extract(json, "$.in_reply_to_status_id_str") AS prev_id ' +
                    'FROM boards WHERE id = ?', board_id, function(err, board) {
          if(err) {
            console.log("Error finding previous board to " + board_id);
            return;
          }
          
          if(board) {
            if(board.is_board) {
              cb(null, board_id, board.is_end)
            } else {
              get_prev(board.prev_id, cb, depth+1);
            }
          } else {
            cb("Board not found!", null, null);
          }
        })
      }
      
      get_prev(board_info.prev_id, function(err, prev_id, prev_is_end) {
        // If err, board will be null which is what we want
        let score = parse_score(board_info.board);
        let role = null;
        if(board_info.is_end) {
          role = "end";
        } else if(prev_is_end) {
          role = "start";
        }
      
        self.db.run("REPLACE INTO board_meta VALUES(?,?,?, ?,?, NULL,?,?)",
                    board_info.id,board_info.prev_id,prev_id,
                    score, role, board_info.retweets,board_info.favorites);
      })
    });
  }
  
  getBoards(cb, opts) {
    var opts = opts || {}
    var limit = opts.limit || 50000; // Disable for now
    var order = order || -1;
    
    var where = [], params = {};
    if(opts.before) {
      where.push("timestamp <= $newest");
      params['$newest'] = opts.before;
      order = -1;
    }
    if(opts.after) {
      where.push("timestamp >= $oldest");
      params['$oldest'] = opts.after;
      order = 1;
    }
    //params['$limit'] = parseInt(limit);
    
    var limit_int = parseInt(limit);
    var order_str = (order > 0 ? "ASC" : "DESC");
    var where_str = "";
    if(where.length) { where_str = "WHERE " + where.join(" AND ") }
    var query = "SELECT CAST(id AS TEXT) as id, board, timestamp, poll_data FROM boards " +
        where_str + " ORDER BY timestamp " + order_str + " LIMIT " + limit_int; 
    
    console.log(query);
    console.log(params);
    
    this.db.all(query, params, function(err, rows) {
      if(err) { console.log(err) }
      console.log(rows);
      let boards = [];
      let min_id = (order < 0) ? rows[rows.length-1].id : rows[0].id;
      let max_id = (order < 0) ? rows[0].id : rows[rows.length-1].id;
      for(var r of rows) {
        var cur_board = new Board(r);
        if(opts.include_meta || cur_board.score !== null) { boards.push(cur_board) };
      }
      cb({
        boards: boards,
        start: min_id,
        end: max_id,
      })
    })
  }
  
  getRaw(cb) {
    var self = this;
    this.db.all("SELECT json FROM boards ORDER BY id DESC", function(err, rows) {
      if(err) { console.log(err) }
      var output = "";
      var expected_next = "";
      for(var r of rows) {
        var parsed = JSON.parse(r.json)
        if(!parsed || !parsed.text) {
          console.log("Couldn't parse " + r.id + ": " + r.json)
          output += "Error at " + r.id + ": " + r.json + "<br/>\n";
          continue;
        }
        if(parsed.text.indexOf("◽") > -1) {
          if(expected_next) {
            if(parsed.id_str != expected_next) {
              // Here we skipped a thing, go fetch it
              /*
              self.getDetails(expected_next, (fulltweet) => {
                self.storeTweet(fulltweet, false);
              })
              */
              output += "❓"
            } else {
              output += "✔️"
            }
          }
          output += '<a href="https://twitter.com/EmojiTetra/status/' + parsed.id_str + '">Board ' + parsed.created_at + '</a><br/>\n';
          expected_next = parsed.in_reply_to_status_id_str;
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