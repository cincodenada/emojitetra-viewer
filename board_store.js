var BigInt = require("big-integer");
var Promise = require("bluebird");

function parse_score(board) {  
  const board_re = [
    RegExp('Score\n\\D+(\\d+)'),
    RegExp('Score (\\d+)'),
    RegExp('^(\\d\\S+)'),
  ]
  
  for(var idx in board_re) {
    var re = board_re[idx];
    var matches = re.exec(board);
    if(matches) {
      return parseInt(matches[1].replace(/\D/g,""));
    }
  }
  
  return null;
}

class Board {
  constructor(board_info) {
    this.board = board_info.board;
    this.id = BigInt(board_info.id_str);
    this.timestamp = board_info.timestamp;
    this.score = parse_score(this.board);
    this.role = board_info.role;
    this.parsePoll(board_info.poll_data);
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
      this.db.all("SELECT CAST(id AS TEXT) as id_str, timestamp FROM boards ORDER BY timestamp DESC LIMIT 5", (err, recent_tweets) => {
        if(err) { console.err("Couldn't get recent tweets: " + err); }

        var existing_tweets = [];
        if(recent_tweets) {
          var last_tweet = recent_tweets[recent_tweets.length-1];
          var last_timestamp = new Date(last_tweet.timestamp);
          existing_tweets = recent_tweets.map(t => t.id_str);
          last_id = BigInt(last_tweet.id_str).subtract(1).toString();
          console.log("Updating tweets from after " + last_tweet.id_str + " @ " + last_timestamp);
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
      this.db.get("SELECT CAST(id AS TEXT) as id_str, timestamp FROM boards ORDER BY timestamp ASC LIMIT 1", (err, first_tweet) => {
        if(err) { console.err("Couldn't get last tweet: " + err); }

        if(first_tweet) {
          var first_timestamp = new Date(first_tweet.timestamp);
          var first_id = first_tweet.id_str;
          console.log("Getting tweets from before " + first_tweet.id_str + " @ " + first_timestamp);
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
          self.getDetails(tweet.id_str).then((fulltweet) => {
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
  
  getDetails(tweet_id) {
    var params = {
      'include_cards': 1,
      'cards_platform': 'iPhone-13',
    };
    return this.twitter.get('statuses/show/' + tweet_id + '.json', params)
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
      return self.db.getAsync("SELECT MAX(timestamp) AS recent FROM poll_data WHERE tweet_id = ?",tweet.id_str)
        .then(timestamp => {
          console.log(timestamp.recent)
          console.log(poll_updated.getTime())
          if(timestamp.recent < poll_updated.getTime()) {
            console.log("Updating tweet " + tweet.id_str);
            return Promise.all([
              self.db.runAsync("UPDATE boards SET poll_data = ? WHERE id = ?",poll_json,tweet.id_str),
              self.db.runAsync("INSERT INTO poll_data VALUES(?,?,?)",tweet.id_str,poll_updated.getTime(),poll_json)
            ])
          } else {
            return self.db.getAsync("SELECT COUNT(*) as cnt FROM boards WHERE id = ?",tweet.id_str)
              .then(data => {
                if(data.cnt == 0) {
                  // I don't know how we get here, hopefully it's transient
                  return self.db.runAsync("INSERT INTO boards VALUES(?,?,?,?,?)",tweet.id_str,tweet.text,tweet_timestamp.getTime(),tweet_json,poll_json)
                }
              })
              .then(result => { console.log("Inserted board") })
          }
        })
    } else {
      console.log("Saving tweet " + tweet.id_str);
      return Promise.all([
        self.db.runAsync("INSERT INTO boards VALUES(?,?,?,?,?)",tweet.id_str,tweet.text,tweet_timestamp.getTime(),tweet_json,poll_json)
          .then(() => { this.updateMeta(tweet.id_str) }),
        self.db.runAsync("INSERT INTO poll_data VALUES(?,?,?)",tweet.id_str,poll_updated.getTime(),poll_json)
      ])
    }
  }
  
  findOtherTweets() {
    let self = this;
    return self.twitter.get('search/tweets', {
      q: '-◽ -"Game continues" -"Continuing game" from:emojitetra',
      result_type: 'recent',
      count: 100,
    }).then(tweets => {
      for(let t of tweets.statuses) {
        self.db.getAsync("SELECT id FROM boards WHERE id = ?", t.id_str).then(row => {
          if(!row) {
            self.storeTweet(t, false);
          }
        })
      }
      return tweets.statuses.length;
    })
  }
  
  fillMissing() {
    let fetched = [];
    let self = this;
    this.db.each('SELECT json_extract(b.json, "$.in_reply_to_status_id_str") AS prev_id FROM boards b ' +
                 'LEFT JOIN boards b2 ON b2.id = prev_id ' +
                 'WHERE b2.id IS NULL AND prev_id != "" LIMIT 10', function(err, row) {
      if(!err) {
        console.log(row);
        self.getDetails(row.prev_id).then((fulltweet) => {
          self.storeTweet(fulltweet, false);
          console.log("Recovering " + row.prev_id);
        })
      }
    }, function() {
      self.fillMissing();
    });
  }
  
  getThread(tweet_id, max_tweets, depth) {
    let self = this;
    if(!max_tweets) { max_tweets = 20; }
    if(!depth) { depth = 0; }
    if(depth == max_tweets) { return {total: depth, next: tweet_id} }
    return self.getDetails(tweet_id).then((fulltweet) => {
      console.log("Recovering " + tweet_id);
      self.storeTweet(fulltweet, false);
      if(fulltweet.in_reply_to_status_id_str) {
          return self.getThread(fulltweet.in_reply_to_status_id_str, max_tweets, depth + 1);
      } else if(fulltweet.text.startsWith("Continuing")) {
        return self.getThread(fulltweet.quoted_status_id_str, max_tweets, depth + 1);
      } else {
        return {count: depth, next: tweet_id}
      }
    })
  }
  
  updateMeta(tweet_id) {
    let self = this;
    let query = 
      'SELECT id,' +
      'COALESCE(' +
        'json_extract(json, "$.in_reply_to_status_id_str"),' +
        'json_extract(json, "$.quoted_status_id_str")' +
      ') prev_id,' +
      '(SELECT id FROM boards WHERE timestamp < b.timestamp AND board LIKE "%◽%" ORDER BY timestamp DESC LIMIT 1) prev_board_id,' +
      'NULL score,' +
      'NULL role,' +
      'NULL replies,' +
      'json_extract(json, "$.retweet_count"),' +
      'json_extract(json, "$.favorite_count") ' +
      'FROM boards b '+
      'WHERE b.id = ?';
    
    console.log("Updating meta for tweet " + tweet_id);
    console.log('REPLACE INTO board_meta ' + query);
    return self.db.runAsync('REPLACE INTO board_meta ' + query, tweet_id)
      .then(res => {
        console.log("Updated board meta for tweet " + tweet_id + ", doing calculations...");
        return self.calculateMeta(tweet_id);
      })
  }
  
  calculateMeta(tweet_id, limit) {
    let self = this
    let query = 
      'SELECT CAST(b.id AS TEXT) id_str, b.board,' +
      'b.board LIKE "%🇬 🇦 🇲 🇪%🇴 🇻 🇪 🇷%" AS is_end,'+
      'pb.board LIKE "%🇬 🇦 🇲 🇪%🇴 🇻 🇪 🇷%" AS is_start ' +
      'FROM board_meta bm ' +
        'LEFT JOIN board_meta pbm ON pbm.board_id=bm.prev_board_id ' +
        'LEFT JOIN boards b ON b.id=bm.board_id ' +
        'LEFT JOIN boards pb ON pb.id=pbm.board_id ';
    let params;
    if(tweet_id) {
      query += 'WHERE b.id = ?'
      params = [tweet_id]
    } else {
      query += "WHERE bm.role IS NULL LIMIT " + parseInt(limit)
      params = []
    }
    console.log("Calculating meta for " + (tweet_id || ("limit " + limit)))
    console.log(query);
  
    return self.db.allAsync(query, params).then(boards => {
      let promises = boards.map(board => {
        let role = "";
        if(board.is_end) { role = "end"; }
        if(board.is_start) { role = "start"; }
        if(board.is_end && board.is_start) { console.log("End and start!!"); }
        let params = [parse_score(board.board), role, board.id_str]
        console.log(board);
        console.log(params);
        return new Promise((resolve, reject) => {
          self.db.run(
            'UPDATE board_meta SET score = ?, role = ? WHERE board_id = ?',
            params,
            (err) => {
              if(err) { reject(err); }
              else { resolve({id: board.id_str, changes: this.changes}) }
            })
        }).then(res => res, err => ({status: "Error", error: err})) // Reflect this
      })
      if(promises.length == 1) {
        return promises[0];
      } else {
        return Promise.all(promises);
      }
    })
  }
  
  makeQuery(opts) {
    var opts = opts || {}
    var limit = opts.limit || 50000; // Disable for now
    var order = order || -1;
    var sort_field = opts.sort_field || "timestamp"
    
        console.log(opts)
    var where = [], params = {};
    let join = ''
    let fields = ['CAST(id AS TEXT) as id_str', 'board', 'timestamp', 'poll_data', 'role']
    if(opts.before) {
      where.push(sort_field + " <= $newest");
      params['$newest'] = opts.before;
      order = -1;
    }
    else if(opts.after) {
      where.push(sort_field + " >= $oldest");
      params['$oldest'] = opts.after;
      order = 1;
    } else if(opts.special) {
      where.push('role != "" OR id = (SELECT MAX(id) FROM boards)')
    }
    //params['$limit'] = parseInt(limit);
    
    var limit_int = parseInt(limit);
    var order_str = (order > 0 ? "ASC" : "DESC");
    var where_str = "";
    if(where.length) { where_str = "WHERE " + where.join(" AND ") }
    var query = "SELECT " + fields.join(',') + " FROM boards LEFT JOIN board_meta bm ON bm.board_id = id " +
        where_str + " ORDER BY " + sort_field + " " + order_str + " LIMIT " + limit_int; 
    
    return {
      query: query,
      params: params,
    }
  }
  
  getBoards(cb, opts) {
    let qs = [];
    if(opts.around) {
      let bopts = Object.assign({}, opts);
      let aopts = Object.assign({}, opts);
      bopts.before = opts.around;
      aopts.after = opts.around;
      aopts.limit = bopts.limit = Math.round(opts.limit/2 + 0.5)
      // Around uses tweet IDs
      aopts.sort_field = bopts.sort_field = "id";
      
      qs.push(this.makeQuery(bopts));
      qs.push(this.makeQuery(aopts));
    } else {
      qs.push(this.makeQuery(opts));
    }
    console.log(qs);
    
    let boards = [];
    let promises = [];
    let self = this;
    for(let q of qs) {
      let curp = new Promise((resolve, reject) => {
        self.db.all(q.query, q.params, function(err, rows) {
          if(err) { console.log(err); reject(err) }
          //console.log(rows);
          //let min_id = (order < 0) ? rows[rows.length-1].id : rows[0].id;
          //let max_id = (order < 0) ? rows[0].id : rows[rows.length-1].id;
          for(var r of rows) {
            var cur_board = new Board(r);
            if(opts.include_meta || cur_board.score !== null) { boards.push(cur_board) };
          }
          resolve()
        })
      });
      promises.push(curp);
    }
    Promise.all(promises)
      .then(function(vals) { cb({ boards: boards }) })
      .catch(function(err) { cb({ error: err }) })
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
          output += '<a href="/' + parsed.id_str + '">Board ' + parsed.created_at + '</a><br/>\n';
          expected_next = parsed.in_reply_to_status_id_str;
        } else if(parsed.text.indexOf("new thread") > -1) {
          output += '<a href="/' + parsed.id_str + '">Continuation ' + parsed.created_at + '</a><br/>\n';
        } else {
          output += '<a href="/' + parsed.id_str + '">Other: ' + parsed.text + ' @ ' + parsed.created_at + '</a><br/>\n';          
        }
      }
      cb(output)
    })
  }
}