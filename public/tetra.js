// Shared tetra bits
const labels = ["↔️ Left or Right","⬅️ Left","➡️ Right","🔄 Rotate","⬇️ Down","⏬ Plummet","⬇️ Stop"];
const rank_icons = ["🔹","🏆","🥇","🥈","🥉"];

function setPoll(poll, votes) {
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

function buildPollElement(label, percent, val, rank) {
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

