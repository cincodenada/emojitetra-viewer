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
  let curboard = 0;
  let play_timeout = null;
  
  emoji.img_sets.google.sheet="https://cdn.glitch.com/ca559128-0a9d-41fe-94fe-ea43fec31feb%2Fsheet_google_64.png?1526256436974";
  emoji.img_set = "google";
  emoji.use_sheet = true;
  
  // define variables that reference elements on our page
  const container = document.getElementById('current');
  const board = document.getElementById('board');
  const votes = document.getElementById('votes');
  const prev = document.getElementById('prev');
  const play = document.getElementById('play');
  const next = document.getElementById('next');
  const date = document.getElementById('date');
  const board_re = RegExp('^\\d+');
  
  // a helper function to call when our request for dreams is done
  const updateBoards = function() {
    // parse our response to convert to JSON
    boards = JSON.parse(this.responseText);
    console.log(boards);
    updateBoard(0);
  }
  
  const buildPollElement = function(label, percent, val, is_winner) {
    var row = document.createElement('div');
    var icon = document.createElement('span');
    icon.className = 'vote_icon';
    //icon.innerHTML = emoji.replace_unified(label);
    icon.innerHTML = label;
    var bar = document.createElement('div');
    bar.style.width = 5*percent + "em";
    if(is_winner) {
      bar.className = "vote_bar winner";
    } else {
      bar.className = "vote_bar";
    }

    row.appendChild(icon);
    row.appendChild(bar);
    row.appendChild(document.createTextNode(val));
    return row
  }
  
  const updateBoard = function(dir) {
    let orig_board = curboard;
    do {
      // Minus cause they're sorted DESC
      // And I want +1 to step forward in time
      curboard -= dir;
      curboard = curboard.mod(boards.length);
      //console.log("Checking " + curboard)
    } while(!board_re.test(boards[curboard].board) && curboard != orig_board)
    //console.log(curboard);
    board.innerText = boards[curboard].board;
    var tweet_date = new Date(boards[curboard].timestamp)
    date.innerText = tweet_date;
    votes.innerHTML = "";
    var poll = boards[curboard].poll_data;
    var total = 0;
    var winner = 0;
    if(poll) {
      for(var choice of Object.keys(poll)) {
        var num = parseInt(poll[choice]); 
        total += num;
        winner = Math.max(winner, num);
      }
      for(var choice of Object.keys(poll)) {
        var val = poll[choice];
        var voterow = buildPollElement(choice[0], val/total, val, val==winner);
        votes.appendChild(voterow);
      }
    }
    
    board.innerHTML = emoji.replace_unified(board.innerHTML);
  }
  
  const play_step = function() {
    updateBoard(1);
    play_timeout = setTimeout(play_step, play_delay);
  }
  
  // request the dreams from our app's sqlite database
  const dreamRequest = new XMLHttpRequest();
  dreamRequest.onload = updateBoards;
  dreamRequest.open('get', '/boards');
  dreamRequest.send();

  prev.onclick = function(event) {
    clearTimeout(play_timeout);
    updateBoard(-1);
  }
  play.onclick = function(event) {
    play_step();
  }
  next.onclick = function(event) {
    clearTimeout(play_timeout);
    updateBoard(1);
  }
})()