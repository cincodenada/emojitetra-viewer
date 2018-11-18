// client-side js
// run by the browser each time your view template referencing it is loaded

// Make modulo work like we want it to
Number.prototype.mod = function(n) {
    return ((this%n)+n)%n;
};

// Binary search whee
function bin_search(a, value, closest_dir, wrap) {
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
  
  // Edge cases (heh)
  if(lo == a.length && closest_dir != -1) { return wrap ? 0 : null; }
  if(hi == -1 && closest_dir != 1) { return wrap ? a.length-1 : null; }  
  
  if(closest_dir) {
    if(Math.sign(a[mid] - value) == closest_dir) {
      return mid
    } else {
      return mid + closest_dir
    }
  }
  
  return null;
}

//for requiring a script loaded asynchronously.
//from https://stackoverflow.com/a/37157516/306323
function loadAsync(src, callback, relative){
    var baseUrl = "/";
    var script = document.createElement('script');
    if(relative === true){
        script.src = baseUrl + src;  
    }else{
        script.src = src; 
    }

    if(callback !== null) {
        if (script.readyState) { // IE, incl. IE9
            script.onreadystatechange = function() {
                if (script.readyState == "loaded" || script.readyState == "complete") {
                    script.onreadystatechange = null;
                    callback();
                }
            };
        } else {
            script.onload = function() { // Other browsers
                callback();
            };
        }
    }
    document.getElementsByTagName('head')[0].appendChild(script);
}

// Milliseconds between frames in "play mode"
// It's a global, overwrite this to change the speed!
// "play_delay = 250" in the console to get 4fps
let play_delay = 1000;

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
  
  // List of timestamps
  let checkpoints = [];
  
  const chunk_size = 50;
  let cur_request = null;

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
      let prev = null
      let next = null;
      let idx = 0;
      while(idx < ranges.length) {
        next = ranges[idx];
        // Skip all the ones we start after
        if(start < next[0]) { break; }
        idx++;
        prev = next;
        next = null;
      }
      
      let overlap_prev = (prev && start <= prev[1])
      let overlap_next = (next && end >= next[0])
      if(overlap_prev && overlap_next) {
        // We may overlap multiple ranges
        // Make sure we subsume them all
        while(ranges[idx] && ranges[idx][0] <= next[1]) {
          prev[1] = Math.max(prev[1], ranges[idx][1]);
          ranges.splice(idx,1);
        }
      } else if(overlap_prev) {
        prev[1] = end
      } else if(overlap_next) {
        next[0] = start
        next[1] = Math.max(next[1], end)
        
        idx++;
        while(ranges[idx] && ranges[idx][0] <= next[1]) {
          next[1] = Math.max(next[1], ranges[idx][1]);
          ranges.splice(idx,1);
        }
      } else {
        ranges.splice(idx, 0, [start, end])
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
    if(prev && prev[1] < board_ts[board_ts.length-1]) {
      gaps_fwd[prev[1]] = prev[1]
    }
  }
  
  this.getContainingRange = function(ts) {
    let prev = null
    for(let cur of ranges) {
      // Go until we pass our number
      if(ts < cur[0]) {
        if(prev && ts <= prev[1]) {
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
    let looped = false;
    if(idx !== null) {
      let cur_idx = idx;
      for(let d=0; d < margin; d++) {
        if(gap_map[board_ts[cur_idx]] !== undefined) {
          let target = board_ts[cur_idx];
          if(direction == 0) { target = boards[target].id }
          let promise = this.getBoards(target, direction);
          // If we need this board, wait on it
          if(d == 0) { return promise; }
          else { return Promise.resolve(true); }
        } else if(!looped && cur_idx < 0) {
          // Loop, and decrement d so we try this board again
          cur_idx = board_ts.length;
          d--;
          looped = true;
        } else if(!looped && cur_idx >= board_ts.length) {
          // Ditto for the other direction
          cur_idx = -1;
          d--;
          looped = true;
        }
        cur_idx += direction;
        // If we loop again, we're good
        if(looped && (cur_idx >= board_ts.length || cur_idx < 0)) { 
          return Promise.resolve(true);
        }
      }
    }
    // TODO: else (shouldn't happen?)
    return Promise.resolve(false);
  }
  
  // target is a timestamp for before/after, tweet ID for around
  // this is so we can load tweet ID's...bleh
  this.getBoards = function(target, direction, cb) {
    let qs = "";
    if(target) {
      // Request a little extra margin, to allow for various slop
      // Mainly non-game tweets, which are fetched but not added
      let comfy_chunk = Math.round(chunk_size*1.2)
      if(direction == 0) {
        qs = '?around=' + target + '&count=' + comfy_chunk;
      } else if(direction == 1) {
        qs = '?after=' + target + '&count=' + comfy_chunk;
      } else {
        qs = '?before=' + target + '&count=' + comfy_chunk;
      }
    }
    
    // Load the boards!
    // These come back total unordered at this point
    // TODO: Check to make sure this request covers us? Hmmm
    if(!cur_request) {
      cur_request = new Promise((resolve, reject) => {
        let self = this;
        let dreamRequest = new XMLHttpRequest();
        dreamRequest.onload = function() {
          self.addBoards(JSON.parse(this.responseText), true)
          cur_request = null
          if(cb) { cb() }
          resolve();
        };
        dreamRequest.open('get', '/boards' + qs);
        dreamRequest.send();
      });
    }
    return cur_request;
  }
  
  this.getSpecial = function(cb) {
    let self = this;
    let dreamRequest = new XMLHttpRequest();
    dreamRequest.onload = function() {
      let response = JSON.parse(this.responseText);
      checkpoints = response.boards.map(b => b.timestamp);
      checkpoints.sort();
      self.addBoards(response, false);
      if(cb) { cb() }
    };
    dreamRequest.open('get', '/boards?special&count=10000');
    dreamRequest.send();
  }
  
  this.getLatest = function() {
    // Run the default 
    let load = board_ts.length ? Promise.resolve() : this.getBoards();
    return load.then(() => {
      return boards[board_ts[board_ts.length-1]];
    });
  }
  
  this.getId = function(tweet_id) {
    let idx = bin_search(board_ts, id_map[tweet_id])
    if(idx) {
      return this.loadBoard(idx, 0);
    } else {
      return this.getBoards(tweet_id, 0).then(() => {
        return boards[id_map[tweet_id]];
      })
    }
  }
  
  this.getNext = function(from_ts, direction) {
    return this.loadBoard(bin_search(board_ts, from_ts + direction, direction, true), direction);
  }
  
  this.getCheckpoint = function(from_ts, direction) {
    // We nudge by direction so we don't stay on the same one
    let checkpoint_idx = bin_search(checkpoints, from_ts + direction, direction, true)
    return this.getNext(checkpoints[checkpoint_idx], 0)
  }
  
  this.loadBoard = function(idx, direction) {
    // Return a promise, which is just for timing: wait until we're sure
    // that we can load this board
    return this.ensureMargin(idx, direction, chunk_size).then(() => {
      return boards[board_ts[idx]];
    })
  }
  
  this.getScores = function() {
    let final_scores = checkpoints.filter(function(ts) { return boards[ts].score > 0; });
    final_scores.sort(function(a,b) { return boards[b].score-boards[a].score; });
    return final_scores.map(function(ts) { return boards[ts] });
  }
}

function EmojiWrapper(emoji_sheet, activate_checkbox, notify_elm) {
  let emoji_ready = false;
  let emojify_elms = [];
  let convertor = null;
  
  function isLoaded(img) {
      // During the onload event, IE correctly identifies any images that
      // weren’t downloaded as not complete. Others should too. Gecko-based
      // browsers act like NS4 in that they report this incorrectly.
      if (!img.complete) {
          return false;
      }

      // However, they do have two very useful properties: naturalWidth and
      // naturalHeight. These give the true size of the image. If it failed
      // to load, either of these should be zero.
      if (img.naturalWidth === 0) {
          return false;
      }

      // No other way of checking: assume it’s ok.
      return true;
  }
  
  function emojify() {
    if(activate_checkbox.checked) {
      if(emoji_ready && convertor) {
        for(let elm of emojify_elms) {
          elm.innerHTML = convertor.replace_unified(elm.innerHTML);
        }
      }
    }
  }
  
  if(notify_elm) { notify_elm.style.display = ""; }

  loadAsync('emoji.min.js', function() {
    convertor = new EmojiConvertor();
    convertor.img_sets.twitter.sheet="https://cdn.glitch.com/ca559128-0a9d-41fe-94fe-ea43fec31feb%2Fsheet_twitter_32.png";
    convertor.img_set = "twitter";
    convertor.use_sheet = true;

    if(notify_elm && emoji_ready) { notify_elm.style.display = "none"; }

    emojify();
  })

  if(isLoaded(emoji_sheet)) {
    emoji_ready = true;
  } else {
    emoji_sheet.addEventListener("load", function() {
      emoji_ready = true;
      if(notify_elm && convertor) { notify_elm.style.display = "none"; }
      emojify();
    });
  }
  
  activate_checkbox.onchange = function(event) {
    emojify();
  }
  
  this.register = function(elm) {
    emojify_elms.push(elm);
    if(emoji_ready && convertor) {
      emojify();
    }
  }
  this.clear = function() {
    emojify_elms = [];
  }
}

(function(){
  let emojify = new EmojiWrapper(
    document.getElementById('emoji_sheet'),
    document.getElementById('replace_emoji'),
    document.getElementById('loading_emoji')
  );
  let boards = new BoardBin();
  let labels = ["↔️ Left or Right","⬅️ Left","➡️ Right","🔄 Rotate","⬇️ Down","⏬ Plummet","⬇️ Stop"];
  let rank_icons = ["🔹","🏆","🥇","🥈","🥉"];
  let curboard = null;
  let play_timeout = null;
  let starts = [];
  let final_boards = [];
  let idmap = {};
  
  // If we have a play speed param, set it
  if(play_speed) {
    set_fps(play_speed);
  }
  
  let load_boards = cur_tweet ? boards.getId(cur_tweet) : boards.getLatest();
  load_boards.then(board => {
    renderBoard(board)
    if(play_speed) { play_step(); }
  });
  
  boards.getSpecial(function() {
    let final_boards = boards.getScores();
    high_scores.innerHTML = "";
    for(var b of final_boards.slice(0,5)) {
      var link = document.createElement('a')
      link.href = '/' + b.id;
      link.innerText = b.score;
      high_scores.append(link);
      // If we're not an endgame, we're the current game
      if(!b.role) {
        let tag = document.createElement('b');
        tag.innerText = " *Current Game*";
        high_scores.append(tag)
      }
      high_scores.append(document.createElement('br'))
    }
  })
  
  // Now get to the rest of the business...
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
  const current = document.getElementById('current');
  const date = document.getElementById('date');
  const permalink = document.getElementById('permalink');
  const fps = document.getElementById('fps');
  const board_re = [
    RegExp('^(\\d+)'),
    RegExp('Score (\\d+)'),
  ]
  
  const buildPollElement = function(label, percent, val, rank) {
    if(!rank) { rank = 0 }
    var row = document.createElement('div');
    var icon = document.createElement('span');
    icon.className = 'vote_icon';
    icon.innerHTML = label;
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
    // Update global state
    curboard = cboard;
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
    
    // Clear the waitlist
    emojify.clear();
    emojify.register(votes)
    emojify.register(board);
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
    /*
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
    */
    boards.getCheckpoint(curboard.timestamp, dir).then(renderBoard);
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
    boards.getNext(curboard.timestamp, dir).then(renderBoard);
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
  current.onclick = function(event) {
    clearInterval(play_timeout);
    boards.getLatest().then(renderBoard);
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