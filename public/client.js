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
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  
  // a helper function to call when our request for dreams is done
  const updateBoards = function() {
    // parse our response to convert to JSON
    boards = JSON.parse(this.responseText);
    console.log(boards);
    updateBoard();
  }
  
  const updateBoard = function() {
    curboard = curboard.mod(boards.length);
    console.log(curboard);
    board.innerText = boards[curboard].board;
  }
  
  // request the dreams from our app's sqlite database
  const dreamRequest = new XMLHttpRequest();
  dreamRequest.onload = updateBoards;
  dreamRequest.open('get', '/boards');
  dreamRequest.send();

  prev.onclick = function(event) {
    curboard += 1;
    updateBoard();
  }
  next.onclick = function(event) {
    curboard -= 1;
    updateBoard();
  }
})()