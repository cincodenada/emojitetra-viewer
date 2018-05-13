// client-side js
// run by the browser each time your view template referencing it is loaded

// Make modulo work like we want it to
Number.prototype.mod = function(n) {
    return ((this%n)+n)%n;
};

(function(){
  let boards = [];
  let curboard = 0;
  
  // define variables that reference elements on our page
  const board = document.getElementById('board');
  const votes = document.getElementById('votes');
  const prev = document.getElementById('prev');
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
    icon.innerText = label;
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
      curboard += dir;
      curboard = curboard.mod(boards.length);
      //console.log("Checking " + curboard)
    } while(!board_re.test(boards[curboard].board) && curboard != orig_board)
    console.log(curboard);
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
  }
  
  // request the dreams from our app's sqlite database
  const dreamRequest = new XMLHttpRequest();
  dreamRequest.onload = updateBoards;
  dreamRequest.open('get', '/boards');
  dreamRequest.send();

  prev.onclick = function(event) {
    updateBoard(1);
  }
  next.onclick = function(event) {
    updateBoard(-1);
  }
})()