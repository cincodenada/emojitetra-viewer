function ScoreChart() {
  let points_per_hour = 1200;
  let dotted_end = 1e5;
  
  let width = 960;
  let height = 960;
  let margin = 50;
  let separation = 5000;

  /* Prepare the chart elements */
  let container = d3.select('#scores')
  let chart = container
    .append('svg')
    .attr('width', width)
    .attr('height', height)
  
  let x = d3.scaleLinear()
  let y = d3.scaleLinear()
  let color = d3.scaleOrdinal(d3.schemePaired)
  
  let xAxis = d3.axisBottom(x).ticks(width / 80).tickSizeOuter(0)
  let xAxisElm = chart.append("g")
    .attr("transform", `translate(0,${height - margin})`)
  
  
  let yAxes = chart.append("g")
      .selectAll("g")
  
  // line
  let line = d3.line()
    .defined(d => !isNaN(d.score))
    .x(d => x(d.time))
    .y((d, i) => y(d.score))
  
  let lines = chart.append("g").selectAll("path")

  function loadData() {
    let indata = JSON.parse(this.responseText)
    indata.sort((a, b) => d3.ascending(a[0], b[0]));
    let start = null;
    let last_score = null
    let data = []
    let curdata = []
    let idx = 0;

    for(let d of indata) {
      if(!start || (d[1] == 0 && last_score != 0)) {
        if(curdata.length) {
          let last_point = curdata[curdata.length-1]
          data.push({
            start: start,
            idx: idx,
            points_per_hour: last_point.score/last_point.time,
            last: last_point,
            data: curdata,
          })
        }
        start = d[0];
        curdata = [];
        idx++;
      }
      curdata.push({time: (d[0] - start)/60/60/24, score: d[1]})
      last_score = d[1];
    }
    let last_point = curdata[curdata.length-1]
    data.push({
      start: start,
      idx: idx,
      points_per_hour: last_point.score/last_point.time,
      last: last_point,
      data: curdata,
    })

    data.sort((a, b) => a.points_per_hour - b.points_per_hour)

    let num_series = data.length;

    for(let s=0; s < num_series; s++) {
      let cur_series = data[s]
      cur_series.sort_idx = s;
    }

    x.domain([0, d3.max(data, d => d3.max(d.data, d => d.time))])
      .range([margin, width - margin])
    y.domain([0, d3.max(data, d => d3.max(d.data, d=> d.score))]).nice()
//      .domain([-10000, 10000]).nice()
      .range([height - margin, margin])
    color.domain(d3.map(data, d => d.start).keys())

    // x axis
    xAxisElm.call(xAxis)

    let rot_angle = Math.atan((y(points_per_hour)-y(0))/(x(1)-x(0)))
    let rot_deg = rot_angle*180/Math.PI

    let axisSlanted = function(d) {
      if(d.fit) { return; }

      let max_time = Math.max(d.last.time, d.last.score/points_per_hour)
      let max_score = Math.max(d.last.score, d.last.time*points_per_hour)

      let ys = d3.scaleLinear()
        .domain([0, max_score])
        .range([y(0), y(max_score/-Math.sin(rot_angle))])

      let axis = d3.axisRight(ys).tickSize(0)
      let a = d3.select(this)
        .attr("class", "subaxis")
        .call(axis)
      a.selectAll(".tick").remove()
    }
    
    // y axes
    yAxes
      .data(data)
      .enter().append("g")
        .attr("transform", d => `translate(0,${y(0) - y((d.sort_idx-num_series+1)*separation)}) rotate(${90+rot_deg},${x(0)},${y(0)}) translate(${margin},0)`)
        .each(axisSlanted)

    // data it up 
    lines.data(data)
      .enter().append("path")
        .attr("class", "line")
        .attr("stroke", (d, i) => color(i))
        .attr("transform", d => `translate(0,${y(0) - y((d.sort_idx-num_series+1)*separation)})`)
        .attr("d", d => line(d.data))

    chart
      .on("mouseover", d => {
        tooltip.transition()
          .duration(500)
          .style("opacity","1")
        tooltip
          .style("left",(d3.event.pageX) + "px")
          .style("top",(d3.event.pageY) + "px")
      })

    // Lifted from https://stackoverflow.com/a/34887578/306323
    // append a g for all the mouse over nonsense
    var mouseG = chart.append("g")
      .attr("class", "mouse-over-effects");

    // this is the vertical line
    mouseG.append("path")
      .attr("class", "mouse-line")
      .style("stroke", "black")
      .style("stroke-width", "1px")
      .style("opacity", "0");

    let text_margin = 5
    let circle_radius = 7
    let textpos = [circle_radius*.7,circle_radius*.7]

    // here's a g for each circle and text on the line
    var mousePerLine = mouseG.selectAll('.mouse-per-line')
      .data(data)
      .enter()
      .append("g")
      .attr("class", "mouse-per-line");

    let tooltip = d3.select('#scores')
      .append("div")
      .selectAll("div")
      .data(data)
      .enter()
        .append("div")
        .attr("class", "tooltip")
        .attr("id", d => "tooltip-" + +d.start)
        .style("display", "none");

    // the circle
    mousePerLine.append("circle")
      .attr("r", circle_radius)
      .style("stroke", function(d) {
        return color(d.sort_idx);
      })
      .style("fill", "none")
      .style("stroke-width", "1px")

    let timeFormat = d3.timeFormat("%e %b")

    // rect to capture mouse movements
    mouseG.append('svg:rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .on('mouseout', function() { // on mouse out hide line, circles and text
        chart.select(".mouse-line")
          .style("opacity", "0");
        chart.selectAll(".mouse-per-line")
          .style("display", "none");
        container.selectAll(".tooltip")
          .style("display", "none");
      })
      .on('mouseover', function() { // on mouse in show line, circles and text
        chart.select(".mouse-line")
          .style("opacity", "1");
        chart.selectAll(".mouse-per-line")
          .style("display", "");
      })
      .on('mousemove', function() { // mouse moving over canvas
        let mouse = d3.mouse(this);

        // move the vertical line
        d3.select(".mouse-line")
          .attr("d", function() {
            var d = "M" + mouse[0] + "," + height;
            d += " " + mouse[0] + "," + 0;
            return d;
          });

        // position the circle and text
        d3.selectAll(".mouse-per-line")
          .attr("transform", function(d, i) {
            var xpos = mouse[0],
                xDate = x.invert(xpos),
                bisect = d3.bisector(function(d) { return d.time; }).left;
                idx = bisect(d.data, xDate);

            let end_margin = 2; // days
            if(!d.data[idx] || idx == 0) {
              if(!d.data[idx]) { idx = d.data.length - 1; }
              if(Math.abs(d.data[idx].time - xDate) > end_margin) {
                d3.select('#tooltip-' + +d.start).style('display', 'none')
                d3.select(this).style('display', 'none');
                return "";
              }
              xpos = x(d.data[idx].time)
            }

            d3.select(this).style('display', '');
            let cur_val = d.data[idx];
            let pos = {x: xpos, y: y(cur_val.score)};
            let adj_y = y(0) - y((d.sort_idx-num_series+1)*separation);

            d3.select('#tooltip-' + +d.start)
              .text(`${timeFormat((d.start+cur_val.time*60*60*24)*1000)}: ${cur_val.score} points`)
              .style('display','')
              .style('left', (pos.x + textpos[0]) + "px")
              .style('top', (pos.y + textpos[1] + adj_y) + "px")

            // return position
            return "translate(" + xpos + "," + (pos.y + adj_y) + ")";
          });
      });
  }
  
  this.requestData = function() {
    let dreamRequest = new XMLHttpRequest();
    dreamRequest.onload = loadData;
    dreamRequest.open('get', '/scores');
    dreamRequest.send();  
  }
}

function VotesChart() {
  let width = 960;
  let height = 200;
  let margin = 20;
  let voteFormat = d3.timeFormat("%e %b %H:%M")
  
  /* Initialize elements */
  let container = d3.select('#votes')
  let chart = container.append('svg')
    .attr('width', width)
    .attr('height', height);
  
  let tooltip = container.append('div')
    .attr('class','tooltip')
    .style('display', 'none')
  
  let x = d3.scaleTime()
  let y = d3.scaleLinear()
  let y_count = d3.scaleLinear()
  
  let xAxis = d3.axisBottom(x)
  let countAxis = d3.axisRight(y_count)

  let bars = chart.append("g")
    .attr("transform", `translate(0,${margin})`)
    .attr("class", "bars")
    .selectAll("rect")
  
  let shadowbars = chart.append("g")
    .attr("transform", `translate(0,${margin})`)
    .attr("class", "shadowbars")
    .selectAll("rect")
  
  let xAxisElm = chart.append("g")
      .attr("transform", `translate(0,${height-margin})`)
  let countAxisElm = chart.append("g")
    .attr("transform", `translate(${width-margin*3},0)`)

  // y label
  chart.append("text")
    .attr("class", "count_label")
    .attr("text-anchor", "middle")
    .attr("transform", `translate(${width-margin},${height/2}) rotate(90)`)
    .text("Total number of votes");
  
  // line
  let line = d3.line()
    .defined(d => !isNaN(d.total))
    .x(d => x(d.timestamp))
    .y(d => y_count(d.total))
  
  let votesline = chart.append("path")
  
  function loadData() {
    let indata = JSON.parse(this.responseText)
    
    let minmax = (domain, value) => {
      if(!domain[0] || domain[0] > value) { domain[0] = value; }
      if(!domain[1] || domain[1] < value) { domain[1] = value; }
    }
    
    // bar width, in ms
    let barwidth = (20*60*1000)*0.9
    
    let dtime = []
    let dratio = []
    let dtotal = []
    for(let d of indata) {
      let total = 0;
      let winner;
      for(let opt in d.votes) {
        let curvotes = parseInt(d.votes[opt])
        if(!winner || curvotes > d.votes[winner]) {
          winner = opt
        }
        total += curvotes
      }
      d.winner = winner;
      d.ratio = (total-d.votes[winner])/d.votes[winner];
      d.total = total;
      d.timestamp = new Date(d.timestamp*1000)
      minmax(dtime, d.timestamp);
      minmax(dratio, d.ratio);
      minmax(dtotal, d.total);
    }
    
    x.domain([new Date(dtime[0].getTime()-barwidth/2), new Date(dtime[1].getTime()+barwidth/2)])
      .range([margin, width-margin*3])
    y.domain([0,dratio[1]])
      .range([height-margin*2, margin])
    y_count.domain([0, dtotal[1]])
      .range([height-margin, margin])

    xAxisElm.call(xAxis)
    countAxisElm.call(countAxis)
    
    let barpx = x(barwidth)-x(0);
    bars.data(indata).enter()
      .append("rect")
        .attr("width", barpx)
        .attr("height", d => Math.abs(y(d.ratio) - y(0)))
        .attr("transform", d => `translate(${x(d.timestamp)},${y(d.ratio)})`)

    shadowbars.data(indata).enter()
      .append("rect")
        .attr("width", barpx)
        .attr("height", height)
        .attr("opacity", "0")
        .attr("transform", d => `translate(${x(d.timestamp)},0)`)
        .on("mouseover", function(d) {
            let pos = getPosition(this);
            tooltip
              .style('display', '')
              .style('left', pos.x+"px")
              .style('top', (pos.y+height-margin)+"px")
              .html(`<a href="/${d.id}">${voteFormat(d.timestamp)}</a><br>Contentiousness: ${(d.ratio*100).toFixed(0)}%<br><div id="votelist"></div>`)

              setPoll(d.votes, document.getElementById('votelist'))
        })
        .on("mouseout", function() {
          return;
          tooltip
            .style('display', 'none')
            .text("")
        })
  
    // data it up 
    votesline.datum(indata)
      .attr("class", "line")
      .attr("d", line)
  }
  
  this.requestData = function() {
    let voteRequest = new XMLHttpRequest();
    voteRequest.onload = loadData;
    voteRequest.open('get', '/votes');
    voteRequest.send();
  }
}

(function() {
  let scores = new ScoreChart();
  scores.requestData();
  
  let votes = new VotesChart();
  votes.requestData(); 
})()

function getPosition(ctx) {
  let rel = ctx.getBoundingClientRect();
  return {
    x: rel.x + window.pageXOffset,
    y: rel.y + window.pageYOffset
  }
}
