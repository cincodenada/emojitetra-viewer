// client-side js
// run by the browser each time your view template referencing it is loaded

// Make modulo work like we want it to
Number.prototype.mod = function(n) {
    return ((this%n)+n)%n;
};

let play_delay = 1000;
var emoji = new EmojiConvertor();

(function(){
  let boards = [];
  let labels = ["↔️ Left or Right","⬅️ Left","➡️ Right","🔄 Rotate","⬇️ Down","⏬ Plummet","⬇️ Stop"];
  let rank_icons = ["🔹","🏆","🥇","🥈","🥉"];
  let curboard = 0;
  let play_timeout = null;
  var starts = [];
  var final_scores = [];
  var idmap = {};
  
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
  const board_re = [
    RegExp('^(\\d+)'),
    RegExp('Score (\\d+)'),
  ]
  
  // a helper function to call when our request for dreams is done
  const updateBoards = function() {
    // parse our response to convert to JSON
    boards = JSON.parse(this.responseText);
    getSummary()
    setBoard(curboard)
  }
  
  const getSummary = function() {
    var flipped = boards.slice().reverse();
    var last_score = null;
    for(var idx in flipped) {
      var b = flipped[idx];
      if(b.score == 0 && last_score !== 0) { 
        starts.push(flipped.length - idx - 1);
        if(last_score) { final_scores.push(last_score); }
      }
      last_score = b.score;
      idmap[b.id] = idx;
    }
    final_scores.sort(function(a,b) { return b-a; });
    high_scores.innerHTML = "";
    for(var score of final_scores.slice(0,3)) {
      high_scores.append(document.createTextNode(score));
      high_scores.append(document.createElement('br'))
    }
  }
  
  const buildPollElement = function(label, percent, val, rank) {
    if(!rank) { rank = 0 }
    var row = document.createElement('div');
    var icon = document.createElement('span');
    icon.className = 'vote_icon';
    //icon.innerHTML = label;
    label = rank_icons[rank] + label
    icon.innerHTML = emoji.replace_unified(label);
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
    curboard = idx;
    
    board.innerText = boards[curboard].board;
    var tweet_date = new Date(boards[curboard].timestamp)
    var date_link = document.createElement('a');
    date_link.innerText = tweet_date;
    date_link.target = "_blank";
    date_link.href = "https://twitter.com/EmojiTetra/status/" + boards[curboard].id;
    date.innerHTML = "";
    date.appendChild(date_link);
    votes.innerHTML = "";
    
    setPoll(boards[curboard].poll_data);
    
    board.innerHTML = emoji.replace_unified(board.innerHTML);
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
  }
  
  const play_step = function() {
    stepBoard(1);
    play_timeout = setTimeout(play_step, play_delay);
  }
  
  // request the dreams from our app's sqlite database
  const dreamRequest = new XMLHttpRequest();
  dreamRequest.onload = updateBoards;
  dreamRequest.open('get', '/boards');
  dreamRequest.send();

  prevStart.onclick = function(event) {
    clearTimeout(play_timeout);
    stepStart(-1);
  }
  prev.onclick = function(event) {
    clearTimeout(play_timeout);
    stepBoard(-1);
  }
  play.onclick = function(event) {
    play_step();
  }
  next.onclick = function(event) {
    clearTimeout(play_timeout);
    stepBoard(1);
  }
  nextStart.onclick = function(event) {
    clearTimeout(play_timeout);
    stepStart(1);
  }
})()