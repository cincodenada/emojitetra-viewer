module.exports = class BoardStore {
  constructor(db, twitter) { 
    this.db = db; 
    this.twitter = twitter;
  }
  
  update(params, cb) {
    var last_id = null;
    this.db.get("SELECT * FROM boards ORDER BY timestamp DESC LIMIT 1", (err, last_tweet) => {
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
        var num_tweets = 0
        var last_tweet_id = null
        for(var tweet of tweets) {
          var tweet_timestamp = new Date(tweet.created_at);
          console.log("Current tweet: " + tweet.id + " @ " + tweet_timestamp);
          // If we hit our last tweet, dump out
          if(from_id && tweet.id <= from_id) {
            console.log("Got all new tweets!");
            cb(null)
            return
          }
          self.db.run("INSERT INTO boards VALUES(?,?,?,?)",tweet.id,tweet.text,tweet_timestamp.getTime(),JSON.stringify(tweet))
          num_tweets++;
          last_tweet_id = tweet.id;
        }

        var total_tweets = prev_count + num_tweets;
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
}

class Board {
}