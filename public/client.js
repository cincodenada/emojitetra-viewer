// client-side js
// run by the browser each time your view template referencing it is loaded

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
    // iterate through every dream and add it to our page
    board.innerText = boards[curboard].board;
  }
  
  // request the dreams from our app's sqlite database
  const dreamRequest = new XMLHttpRequest();
  dreamRequest.onload = updateBoards;
  dreamRequest.open('get', '/boards');
  dreamRequest.send();

  prev.onclick = function(event) {
    curboard -= 1;
    curboard = curboard % boards.length;
    updateBoard();
  }
  next.onclick = function(event) {
    curboard += 1;
    curboard = curboard % boards.length;
    updateBoard();
  }
})()