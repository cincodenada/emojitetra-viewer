module.exports = class BoardStore {
  constructor(db, twitter) { 
    this.db = db; 
    this.twitter = twitter;
  }
  
  update(params, cb) {
    var last_id = null;
    this.db.get("SELECT CAST(id AS TEXT) as id, timestamp FROM boards ORDER BY timestamp DESC LIMIT 1", (err, last_tweet) => {
      if(err) { console.err("Couldn't get last tweet: " + err); }
      
      if(last_tweet) {
        var last_timestamp = new Date(last_tweet.timestamp);
        last_id = last_tweet.id;
        console.log("Getting tweets from after " + last_tweet.id + " @ " + last_timestamp);
      } else {
        console.log("Getting all tweets");
      }
      
      this.getTweets(last_id, null, params, (err, num_tweets) => {
        if(err) {
          cb({"error": err});
        } else {
          cb({"num_tweets": num_tweets});
        }
      })
    })
  }
  
  getTweets(from_id, to_id, params, cb, self, prev_count) {
    if(!self) { self = this; }
    if(!prev_count) { prev_count = 0; }
    
    console.log("Getting tweets from " + from_id + " to "  + to_id + "...");
    if(to_id) { params['max_id'] = to_id; }
    if(from_id) { params['since_id'] = from_id; }
    self.twitter.get('statuses/user_timeline', params, function(error, tweets, twitter_response) {
      if (!error) {
        var num_tweets = 0;
        var ignored_tweets = 0;
        var last_tweet_id = null;
        for(var tweet of tweets) {
          var tweet_timestamp = new Date(tweet.created_at);
          console.log("Current tweet: " + tweet.id_str + " @ " + tweet_timestamp);
          // If we hit our last tweet, dump out
          if(from_id && tweet.id_str <= from_id) {
            console.log("Got all new tweets!");
            cb(null, prev_count+num_tweets-ignored_tweets);
            return;
          } else if(tweet.id_str == to_id) {
            // Don't try to double-add the end tweet
            console.log("Not storing already-seen tweet");
            ignored_tweets++;
            continue;
          }
          self.getDetails(tweet.id_str, (fulltweet) => {
            self.storeTweet(fulltweet);
          })
          num_tweets++;
          last_tweet_id = tweet.id;
        }

        var total_tweets = prev_count + num_tweets - ignored_tweets;
        if(num_tweets) {
          // Down the rabbit hole, time to get more...
          self.getTweets(from_id, last_tweet_id, params, cb, self, total_tweets);
        } else {
          cb(null, total_tweets)
        }
      } else {
        cb(error);
      }
    });
  }
  
  getDetails(tweet_id, cb) {
    console.log("Getting details...");
    var params = {
      'include_cards': 1,
      'cards_platform': 'iPhone-13',
    };
    this.twitter.get('statuses/show/' + tweet_id + '.json', params, function(error, tweets, twitter_response) {
      cb(tweets)
    });
  }
  
  storeTweet(tweet) {
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
      if(poll_data.counts_are_final === false) {
        // Don't store partial boards
        console.log("Not storing partial poll...")
        return false;
      }
    }
    console.log("Saving tweet " + tweet.id_str);
    this.db.run("INSERT INTO boards VALUES(?,?,?,?,?)",tweet.id_str,tweet.text,tweet_timestamp.getTime(),JSON.stringify(tweet),JSON.stringify(poll_data));
    return true;
  }
}

class Board {
}