// client-side js
// run by the browser each time your view template referencing it is loaded

// Make modulo work like we want it to
Number.prototype.mod = function(n) {
    return ((this%n)+n)%n;
};

// Binary search whee
function bin_search(a, value) {
    var lo = 0, hi = a.length - 1, mid;
    while (lo <= hi) {
        mid = Math.floor((lo+hi)/2);
        if (a[mid] > value)
            hi = mid - 1;
        else if (a[mid] < value)
            lo = mid + 1;
        else
            return mid;
    }
    return null;
}

// Milliseconds between frames in "play mode"
// It's a global, overwrite this to change the speed!
// "play_delay = 250" in the console to get 4fps
let play_delay = 1000;
var emoji = new EmojiConvertor();

function BoardBin() {
  let boards = {};
  // Kept sorted, asc timestamp
  let board_ts = [];
  // [start, end]
  let ranges = []
  // start: end
  let gaps_fwd = {};
  // end: start
  let gaps_rev = {};
  // id: timestamp
  let id_map = {};
  
  const chunk_size = 50;
  let cur_request = null;

  // TODO: Ugh, all this has to be bigints and shit
  // Unless we index them by timestamps, which will still be unique for our case...yes...
  // "Continuing", "Continued", and board will all have the same timestamp, but that's fine
  // Cause we ignore those, yay
  // We could avoid is_continuous by checking in_reply_to, but Continuations make that annoying
  // So for now we'll just do some extra queries
  this.addBoards = function(board_data, is_continuous) {
    let new_boards = board_data.boards;
    // Boards could be in either order, so find the start/end
    let new_ranges = []
    if(is_continuous) {
      let start = new_boards[0].timestamp
      let end = new_boards[0].timestamp
      for(let b of new_boards) {
        if(b.timestamp < start) { start = b.timestamp; }
        if(b.timestamp > end) { end = b.timestamp; }
        this.addBoard(b);
      }
      new_ranges.push([start, end])
    } else {
      for(let b of new_boards) {
        new_ranges.push([b.timestamp, b.timestamp])
        this.addBoard(b)
      }
    }
    
    board_ts = Object.keys(boards);
    board_ts.sort();
    
    for(let r of new_ranges) {
      this.addRange(r[0], r[1]);
    }
    
    this.generateGaps();
  }
  
  this.addBoard = function(b) {
    boards[b.timestamp] = b;
    id_map[b.id] = b.timestamp;
  }
  
  this.addRange = function(start, end) {
    if(ranges.length == 0) {
      ranges = [[start, end]]
    } else {
      let prev = null;
      for(let idx in ranges) {
        let cur = ranges[idx];
        // Skip all the ones we start after
        if(start < cur[0]) {
          let overlap_prev = (prev && start <= prev[1])
          let overlap_next = (end >= cur[0])
          if(overlap_prev && overlap_next) {
            // We may overlap multiple ranges
            // Make sure we subsume them all
            while(ranges[idx][0] <= cur[1]) {
              prev[1] = Math.max(prev[1], ranges[idx][1]);
              ranges.splice(idx,1);
            }
          } else if(overlap_prev) {
            prev[1] = end
          } else if(overlap_next) {
            cur[0] = start
          } else {
            ranges.splice(idx, 0, [start, end])
          }
          return
        }
        prev = cur;
      }
    }
  }
  
  this.generateGaps = function() {
    gaps_fwd = {};
    gaps_rev = {}
    let prev = null
    for(let r of ranges) {
      if(prev) {
        gaps_rev[r[0]] = prev[1];
        gaps_fwd[prev[1]] = r[0];
      } else {
        gaps_rev[r[0]] = 0;
        // Don't need a forward gap at 0
      }
      prev = r;
    }
    if(prev) {
      gaps_fwd[prev[1]] = 1
    }
  }
  
  this.getContainingRange = function(id) {
    let prev = null
    for(let cur of ranges) {
      // Go until we pass our number
      if(id < cur[0]) {
        if(prev && id <= prev[1]) {
          // If we're in the previous range, bingo
          return prev;
        } else {
          // Otherwise, we're not in there
          return null;
        }
      }
      let prev = cur;
    }
  }
  
  // We could be way more efficient here, keeping track of where we left off
  // But this'll work and that would be complicated
  this.ensureMargin = function(idx, direction, margin) {
    let gap_map = (direction < 0) ? gaps_rev : gaps_fwd;
    if(idx !== null) {
      let cur_idx = idx;
      for(let d=0; d < margin; d++) {
        if(gap_map[board_ts[cur_idx]] !== undefined) {
          this.getBoards(board_ts[cur_idx], direction);
          return true;
        } else if(cur_idx < 0 || cur_idx >= board_ts.length) {
          /// TODO: Deal with looping
          console.log("Ack, reached end!")
        }
        cur_idx += direction;
      }
    }
    // TODO: else (shouldn't happen?)
    return false;
  }
  
  
  this.getBoards = function(target_id, direction, cb) {
    let qs = "";
    if(target_id) {
      if(direction == 0) {
        // Unsupported currently
        qs = '?around=' + target_id + '&count=' + chunk_size;        
      } else if(direction == 1) {
        qs = '?after=' + target_id + '&count=' + chunk_size;        
      } else {
        qs = '?before=' + target_id + '&count=' + chunk_size;        
      }
    }
    
    // Load the boards!
    // These come back total unordered at this point
    // TODO: Check the id of the request? Hmm
    if(!cur_request) {
      cur_request = qs;
      let self = this;
      let dreamRequest = new XMLHttpRequest();
      dreamRequest.onload = function() {
        self.addBoards(JSON.parse(this.responseText), true)
        cur_request = null
        cb()
      };
      dreamRequest.open('get', '/boards' + qs);
      dreamRequest.send();
    }
  }
  
  this.getLast = function() {
    return boards[board_ts[board_ts.length - 1]];
  }
  
  this.getId = function(tweet_id) {
    return boards[id_map[tweet_id]];
  }
  
  this.getNext = function(from_ts, direction) {
    let next_idx = bin_search(board_ts, from_ts) + direction;
    let self = this;
    setTimeout(function() { self.ensureMargin(next_idx, direction, chunk_size-5) }, 0);
    return boards[board_ts[next_idx]];
  }
}

(function(){
  let boards = new BoardBin();
  let labels = ["↔️ Left or Right","⬅️ Left","➡️ Right","🔄 Rotate","⬇️ Down","⏬ Plummet","⬇️ Stop"];
  let rank_icons = ["🔹","🏆","🥇","🥈","🥉"];
  let curboard = null;
  let play_timeout = null;
  let starts = [];
  let final_boards = [];
  let idmap = {};

  // Board callback function
  const loadBoard = function() {
    // parse our response to convert to JSON
    //getSummary()
    if(cur_tweet) {
      curboard = boards.getId(cur_tweet);
    } else {
      curboard = boards.getLast();
    }
    renderBoard(curboard);
      
    // If we have a play speed param, set it and start playing
    if(play_speed) {
      set_fps(play_speed);
      play_step();
    }
  }
  
  if(cur_tweet) {
    boards.getBoards(cur_tweet, 0, loadBoard)
  } else {
    boards.getBoards(null, null, loadBoard)
  }
  
  // Now get to the rest of the business...
  emoji.img_sets.twitter.sheet="https://cdn.glitch.com/ca559128-0a9d-41fe-94fe-ea43fec31feb%2Fsheet_twitter_32.png?1526257911219";
  emoji.img_set = "twitter";
  emoji.use_sheet = true;
  
  // define variables that reference elements on our page
  const container = document.getElementById('current');
  const board = document.getElementById('board');
  const votes = document.getElementById('votes');
  const prevStart = document.getElementById('prevStart');
  const high_scores = document.getElementById('high_scores');
  const prev = document.getElementById('prev');
  const play = document.getElementById('play');
  const next = document.getElementById('next');
  const nextStart = document.getElementById('nextStart');
  const date = document.getElementById('date');
  const permalink = document.getElementById('permalink');
  const fps = document.getElementById('fps');
  const replaceEmoji = document.getElementById('replace_emoji');
  const board_re = [
    RegExp('^(\\d+)'),
    RegExp('Score (\\d+)'),
  ]
  
  const emojify = function(text) {
    if(replaceEmoji.checked) {
      return emoji.replace_unified(text);
    }
    return text
  }

  
  const getSummary = function() {
    var flipped = boards.slice().reverse();
    var last_score = null;
    for(var idx in flipped) {
      var b = flipped[idx];
      var fwd_idx = flipped.length - idx - 1;
      if(b.score == 0 && last_score !== 0) { 
        if(fwd_idx < flipped.length - 1) { starts.push(fwd_idx+1); }
        starts.push(fwd_idx);
        if(last_score) { final_boards.push(fwd_idx+1); }
      }
      last_score = b.score;
      idmap[b.id] = fwd_idx;
    }
    if(starts[starts.length-1] != 0) { starts.push(0); }
    final_boards.sort(function(a,b) { return boards[b].score-boards[a].score; });
    high_scores.innerHTML = "";
    for(var final_idx of final_boards.slice(0,3)) {
      var b = boards[final_idx];
      var link = document.createElement('a')
      link.href = '/' + b.id;
      link.innerText = b.score;
      high_scores.append(link);
      high_scores.append(document.createElement('br'))
    }
  }
  
  const buildPollElement = function(label, percent, val, rank) {
    if(!rank) { rank = 0 }
    var row = document.createElement('div');
    var icon = document.createElement('span');
    icon.className = 'vote_icon';
    label = rank_icons[rank] + label
    icon.innerHTML = emojify(label);
    var bar = document.createElement('div');
    bar.style.width = 5*percent + "em";
    if(rank === 1) {
      bar.className = "vote_bar winner";
    } else {
      bar.className = "vote_bar";
    }

    row.appendChild(icon);
    row.appendChild(bar);
    row.appendChild(document.createTextNode(val));
    return row
  }
  
  const renderBoard = function(cboard) {
    board.innerText = cboard.board;
    var tweet_date = new Date(cboard.timestamp)
    var date_link = document.createElement('a');
    date_link.innerText = tweet_date;
    date_link.target = "_blank";
    date_link.href = "https://twitter.com/EmojiTetra/status/" + cboard.id;
    date.innerHTML = "";
    date.appendChild(date_link);
    permalink.href = "/" + cboard.id;
    
    
    if(cboard.poll_finished) {
      votes.innerHTML = "";
      setPoll(cboard.poll_data);
    } else {
      votes.innerHTML = "⌛ Poll in progress!";
    }
    
    board.innerHTML = emojify(board.innerHTML);
  }
  
  const setPoll = function(poll) {
    var total = 0;
    var winner = 0;
    if(poll) {
      var choices = Object.keys(poll);
      var vals = [];
      for(var choice of Object.keys(poll)) {
        var num = parseInt(poll[choice]); 
        vals.push(num);
        total += num;
      }
      vals.sort(function(a,b){return b-a});
      var ranks = {}
      var cur_rank = 0;
      var cur_idx = 0;
      var last_val;
      for(var val of vals) {
        cur_idx += 1
        if(val !== last_val) { cur_rank = cur_idx }
        ranks[val] = cur_rank;
      }
      for(var choice of labels) {
        var val = poll[choice] || 0;
        var voterow = buildPollElement(choice.substr(0,choice.indexOf(" ")), val/total, val, ranks[val]);
        votes.appendChild(voterow);
      }
    }
  }
  
  const stepStart = function(dir) {
    if(dir == 1) {
      for(var start_idx of starts) {
        if(start_idx < curboard) {
          setBoard(start_idx);
          return;
        }
      }
      setBoard(starts[0]);
    } else {
      var rev = starts.slice().reverse();
      for(var start_idx of rev) {
        if(start_idx > curboard) {
          setBoard(start_idx);
          return;
        }
      }
      setBoard(rev[0]);
    }
  }
  
  const stepBoard = function(dir, first_load) {
    /*
    let orig_board = curboard;
    if(first_load) {
      orig_board = orig_board + dir;
      orig_board = orig_board.mod(boards.length);
    } else {
      curboard -= dir;
      curboard = curboard.mod(boards.length);
    }
    */
    curboard = boards.getNext(curboard.timestamp, dir);
    renderBoard(curboard);
  }
  
  const play_step = function() {
    stepBoard(1);
    if(!play_timeout) {
      play_timeout = setInterval(play_step, play_delay);
    }
  }
  
  const set_fps = function(fps) {
    play_delay = 1000/fps;
    if(play_timeout) {
      clearInverval(play_timeout);
      play_step();
    }
  }
  
  prevStart.onclick = function(event) {
    clearInterval(play_timeout);
    stepStart(-1);
  }
  prev.onclick = function(event) {
    clearInterval(play_timeout);
    stepBoard(-1);
  }
  play.onclick = function(event) {
    play_step();
  }
  next.onclick = function(event) {
    clearInterval(play_timeout);
    stepBoard(1);
  }
  nextStart.onclick = function(event) {
    clearInterval(play_timeout);
    stepStart(1);
  }
  
  replaceEmoji.onchange = function(event) {
    setBoard();
  }
  
  fps.onkeyup = function(event) {
    var val = this.value;
    if(this.debounce) { clearTimeout(this.debounce) }
    this.debounce = setTimeout(this.onchange, 750);
  }
  
  fps.onchange = function(event) {
    if(this.value) { set_fps(this.value); }
  }
})()