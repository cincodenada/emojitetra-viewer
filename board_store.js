const BigInt = require("big-integer");
const Promise = require("bluebird");
const Log = require("log");

const log = new Log("info");

function parse_score(board) {  
  const score_re = [
    RegExp('Score\n[^\\d\n]+(\\d+)'),
    RegExp('Score (\\d+)'),
    RegExp('^(\\d\\S+)'),
  ]
  
  // Quick hack to skip RTs
  if(board.startsWith("RT")) {
    return null;
  }
  
  for(var idx in score_re) {
    var re = score_re[idx];
    var matches = re.exec(board);
    if(matches) {
      return parseInt(matches[1].replace(/\D/g,""));
    }
  }
  
  return null;
}

function parse_clears(board) {
  const clear_re = [
    RegExp('\\+(\\d+)'),
  ]
  
  for(var idx in clear_re) {
    var re = clear_re[idx];
    let total = 0;
    var matches = re.exec(board);
    while(matches) {
      total += parseInt(matches[1].replace(/\D/g,""))
    }
    if(total) { return total; }
  }
  
  return null;
}

class Board {
  constructor(board_info) {
    this.board = board_info.board;
    this.id = BigInt(board_info.id_str);
    this.timestamp = board_info.timestamp;
    this.score = parse_score(this.board);
    this.clears = parse_clears(this.board);
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
    // Pull recent tweets, up to 5 back in history, to update poll results
    this.db.all("SELECT CAST(id AS TEXT) as id_str, timestamp FROM boards ORDER BY timestamp DESC LIMIT 5", (err, recent_tweets) => {
      if(err) { console.err("Couldn't get recent tweets: " + err); }

      var existing_tweets = [];
      if(recent_tweets) {
        var last_tweet = recent_tweets[recent_tweets.length-1];
        var last_timestamp = new Date(last_tweet.timestamp);
        existing_tweets = recent_tweets.map(t => t.id_str);
        // Subtract 1 so we include the last tweet as well
        last_id = BigInt(last_tweet.id_str).subtract(1).toString();
        log.info("Updating tweets starting from " + last_tweet.id_str + " @ " + last_timestamp);
      } else {
        log.info("No recent tweets found!");
        return;
      }

      this.getTweets(last_id, null, existing_tweets, params, (err, info) => {
        if(err) {
          cb({"error": err});
        } else {
          cb(info);
        }
      })
    })
  }
  
  backfill(params, cb) {
    this.db.get("SELECT CAST(id AS TEXT) as id_str, timestamp FROM boards ORDER BY timestamp ASC LIMIT 1", (err, first_tweet) => {
      if(err) { console.err("Couldn't get last tweet: " + err); }

      if(first_tweet) {
        var first_timestamp = new Date(first_tweet.timestamp);
        var first_id = first_tweet.id_str;
        log.debug("Getting tweets from before " + first_tweet.id_str + " @ " + first_timestamp);
        this.getTweets(null, first_id, params, (err, info) => {
          if(err) {
            cb({"error": err});
          } else {
            cb(info);
          }
        })
      } else {
        log.debug("Bad tweet?")
        log.debug(first_tweet)
      }
    })
  }
  
  getTweets(from_id, to_id, existing_tweets, params, cb, self, tweet_counts, depth) {
    if(!depth) { depth = 0; }
    if(!self) { self = this; }
    if(!tweet_counts) { tweet_counts = {"total": 0, "new": 0}; }
    
    // For if things start getting out of hand
    //log.debug("Depth: " + depth);
    //if(depth > 3) { log.debug("Bailing!"); return; }
    
    log.debug("Getting tweets from " + from_id + " to "  + to_id + "...");
    if(to_id) {
      to_id = BigInt(to_id);
      params['max_id'] = to_id.toString(); 
    }
    if(from_id) {
      from_id = BigInt(from_id);
      params['since_id'] = from_id.toString();
    }
    log.debug(JSON.stringify(params))
    self.twitter.get('statuses/user_timeline', params, function(error, tweets, twitter_response) {
      if (!error && twitter_response.statusCode == 200) {
        var num_tweets = 0;
        var updated = 0;
        log.info(existing_tweets);
        for(var tweet of tweets) {
          var last_id = BigInt(tweet.id_str)
          var tweet_timestamp = new Date(tweet.created_at);
          log.debug("Current tweet: " + tweet.id_str + " @ " + tweet_timestamp);
          
          let exists = existing_tweets &&
            (existing_tweets.indexOf(tweet.id_str) > -1);

          self.getDetails(tweet.id_str).then((fulltweet) => {
            self.storeTweet(fulltweet, exists);
          })
          
          num_tweets++;
          if(exists) { updated++; }
        }
        
        tweet_counts.total += num_tweets;
        tweet_counts.updated += updated;
        tweet_counts.new = tweet_counts.total - tweet_counts.updated;
        
        // If this is the last page, return out
        if(from_id && last_id <= from_id) {
          log.debug("Got all new tweets!");
          cb(null, {"counts": tweet_counts});
          return;
        }
        
        log.debug("Continuing from " + from_id.toString() + " to " + last_id.toString());

        // Don't unconditionally go backwards yet
        if(num_tweets && from_id) {
          // Don't go backwards forever, return after we get 50
          // And send continue information
          if(tweet_counts.total > 50) {
            cb(null, {"counts": tweet_counts, "continue": [from_id.toString(), last_id.toString()]})
          } else {
            // Down the rabbit hole, time to get more...
            self.getTweets(from_id.toString(), last_id.toString(), existing_tweets, params, cb, self, tweet_counts, depth+1);
          }
        } else {
          // We didn't find any tweets
          cb(null, {"counts": tweet_counts})
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
    var tweet_timestamp = new Date(tweet.created_at);
    var tweet_json = JSON.stringify(tweet);
    
    var poll_data = this.parsePoll(tweet.card);
    var poll_updated = new Date(poll_data.last_updated_datetime_utc);
    var poll_json = JSON.stringify(poll_data);
    
    let self = this;
    if(exists) {
      log.debug("Updating tweet " + tweet.id_str)
      // Check if we have new data, and if so update the tweet and add it to the poll_data table
      return self.db.getAsync("SELECT MAX(timestamp) AS recent FROM sampled_data WHERE tweet_id = ?",tweet.id_str)
        .then(row => {
          log.debug("Comparing " + row.recent + " to " + poll_updated.getTime()/1000)
          if(row.recent < poll_updated.getTime()/1000) {
            log.debug("Updating tweet " + tweet.id_str);
            return Promise.all([
              self.db.runAsync("UPDATE boards SET poll_data = ? WHERE id = ?",poll_json,tweet.id_str),
              self.db.runAsync("UPDATE board_meta SET retweets = ?, likes = ? WHERE board_id = ?",tweet.retweet_count,tweet.favorite_count,tweet.id_str),
              self.db.runAsync("INSERT INTO sampled_data VALUES(?,?,?,?,?)",tweet.id_str,poll_updated.getTime()/1000,poll_json,tweet.retweet_count,tweet.favorite_count)
            ])
          } else {
            return self.db.getAsync("SELECT COUNT(*) as cnt FROM boards WHERE id = ?",tweet.id_str)
              .then(data => {
                if(data.cnt == 0) {
                  log.warning('Re-adding "existing" board for ' + tweet.id_str);
                  // I don't know how we get here, hopefully it's transient
                  return self.db.runAsync("INSERT INTO boards VALUES(?,?,?,?,?)",tweet.id_str,tweet.text,tweet_timestamp.getTime()/1000,tweet_json,poll_json)
                }
              })
              .then(result => { log.debug("No updates needed") })
          }
        })
    } else {
      log.notice("Saving new tweet " + tweet.id_str);
      return Promise.all([
        self.db.runAsync("INSERT INTO boards VALUES(?,?,?,?,?,?)",tweet.id_str,tweet.text,tweet_timestamp.getTime()/1000,tweet_json,poll_json,(tweet.text.indexOf("◽") > -1))
          .then(() => this.updateMeta(tweet.id_str)),
        self.db.runAsync("INSERT INTO sampled_data VALUES(?,?,?,?,?)",tweet.id_str,poll_updated.getTime()/1000,poll_json,tweet.retweet_count,tweet.favorite_count)
      ])
    }
  }
  
  parsePoll(card) {
    let poll_data = {}
    if(card) {
      for(var key of Object.keys(card.binding_values)) {
        var val = card.binding_values[key];
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
    return poll_data;
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
        log.debug(row);
        self.getDetails(row.prev_id).then((fulltweet) => {
          self.storeTweet(fulltweet, false);
          log.debug("Recovering " + row.prev_id);
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
      log.debug("Recovering " + tweet_id);
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
      '(SELECT id FROM boards WHERE timestamp < b.timestamp AND is_board ORDER BY timestamp DESC LIMIT 1) prev_board_id,' +
      'NULL score,' +
      'NULL role,' +
      'NULL replies,' +
      'json_extract(json, "$.retweet_count"),' +
      'json_extract(json, "$.favorite_count") ' +
      'FROM boards b '+
      'WHERE b.id = ?';
    
    log.info("Updating meta for tweet " + tweet_id);
    log.debug('REPLACE INTO board_meta ' + query);
    return self.db.runAsync('REPLACE INTO board_meta ' + query, tweet_id)
      .then(res => {
        log.info("Updated board meta for tweet " + tweet_id + ", doing calculations...");
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
    log.info("Calculating meta for " + (tweet_id || ("limit " + limit)))
    log.debug(query);
  
    return self.db.allAsync(query, params).then(boards => {
      let promises = boards.map(board => {
        let role = "";
        if(board.is_end) { role = "end"; }
        if(board.is_start) { role = "start"; }
        if(board.is_end && board.is_start) { log.debug("End and start!!"); }
        let params = [parse_score(board.board), role, board.id_str]
        log.debug(board);
        log.debug(params);
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
    
        log.debug(opts)
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
    log.debug(qs);
    
    let boards = [];
    let promises = [];
    let self = this;
    for(let q of qs) {
      let curp = new Promise((resolve, reject) => {
        self.db.all(q.query, q.params, function(err, rows) {
          if(err) { log.debug(err); reject(err) }
          //log.debug(rows);
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
}