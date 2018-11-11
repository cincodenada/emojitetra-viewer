// client-side js
// run by the browser each time your view template referencing it is loaded

// Make modulo work like we want it to
Number.prototype.mod = function(n) {
    return ((this%n)+n)%n;
};

// Milliseconds between frames in "play mode"
// It's a global, overwrite this to change the speed!
// "play_delay = 250" in the console to get 4fps
let play_delay = 1000;
var emoji = new EmojiConvertor();

let cur_request = null;
let last_chunk = null;
const chunk_size = 50;

function BoardBin() {
  let boards = {};
  // Kept sorted, 0 = most recent
  let board_ids = [];
  // [start, end]
  let ranges = [];
  
  // TODO: Ugh, all this has to be bigints and shit
  this.addBoards = function(boards) {
    let start = boards[0].id;
    let end = boards[0].id;
    for(let b of boards) {
      if(b.id < start) { start = b.id; }
      if(b.id > end) { end = b.id; }
      boards[b.id] = b;
    }
    
    board_ids = Object.keys(boards);
    board_ids.sort().reverse(); // So lazy! Don't care.
    
    let last_range = null;
    for(let idx in ranges) {
      let cur = ranges[idx];
      // Skip all the ones we start after
      if(start < cur[0]) {
        let overlap_prev = (prev && start <= prev[1])
        let overlap_next = (end >= cur[0])
        if(overlap_prev && overlap_next) {
          prev[1] = cur[1];
          delete ranges[idx];
        } else if(overlap_prev) {
          prev[1] = end
        } else if(overlap_next) {
          cur[0] = start
        } else {
          ranges.splice(idx, 0, [start, end])
        }
        return
      }
      let prev = cur;
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
}

(function(){
  let boards = [];
  let labels = ["↔️ Left or Right","⬅️ Left","➡️ Right","🔄 Rotate","⬇️ Down","⏬ Plummet","⬇️ Stop"];
  let rank_icons = ["🔹","🏆","🥇","🥈","🥉"];
  let curboard = 0;
  let play_timeout = null;
  var starts = [];
  var final_boards = [];
  var idmap = {};

  // Board callback function
  const updateBoards = function() {
    // parse our response to convert to JSON
    let board_data = JSON.parse(this.responseText);
    boards = boards.concat(board_data.boards);
    last_chunk = [board_data.start, board_data.end];
    getSummary()
    if(cur_tweet) {
      setBoard(idmap[cur_tweet])
    } else {
      setBoard(curboard)
    }

    // If we have a play speed param, set it and start playing
    if(play_speed) {
      set_fps(play_speed);
      play_step();
    }
    
    cur_request = null;
  }
  
  const getBoards = function(target_id) {
    let qs = "";
    if(!target_id) {
      if(last_chunk) {
        qs = '?before=' + last_chunk[0] + '&count=' + chunk_size;
      }
    } else {
      //TODO
    }
    
    // Load the boards!
    // TODO: Check the id of the request? Hmm
    if(!cur_request) {
      cur_request = qs;
      const dreamRequest = new XMLHttpRequest();
      dreamRequest.onload = updateBoards;
      dreamRequest.open('get', '/boards' + qs);
      dreamRequest.send();
    }
  }
  
  getBoards();
  
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
  
  const setBoard = function(idx) {
    if(idx != null) { curboard = idx; }
    var cboard = boards[curboard];
    
    board.innerText = cboard.board;
    var tweet_date = new Date(cboard.timestamp)
    var date_link = document.createElement('a');
    date_link.innerText = tweet_date;
    date_link.target = "_blank";
    date_link.href = "https://twitter.com/EmojiTetra/status/" + cboard.id;
    date.innerHTML = "";
    date.appendChild(date_link);
    permalink.href = "/" + cboard.id;
    
    votes.innerHTML = "";
    setPoll(boards[curboard].poll_data);
    
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
    let orig_board = curboard;
    if(first_load) { 
      orig_board = orig_board + dir;
      orig_board = orig_board.mod(boards.length);
    } else {
      curboard -= dir;
      curboard = curboard.mod(boards.length);
    }
    setBoard(curboard);
    if(last_chunk && (boards.length - curboard) < chunk_size) {
      getBoards();
    }
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