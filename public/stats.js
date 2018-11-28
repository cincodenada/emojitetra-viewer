(function() {
  let width = 1000;
  let height = 1000;
  let margin = 50;

 const chart = d3.select('#scores')
  .append('svg')
  .attr('width', width)
  .attr('height', height)

  
  let dreamRequest = new XMLHttpRequest();
  dreamRequest.onload = function(){
    let indata = JSON.parse(this.responseText)
    indata.sort((a, b) => d3.ascending(a[0], b[0]));
    let separation = 5000;
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

    let score = 0, time = 0;
    let points_per_hour = 1200;
    let dotted_end = 1e5;

    for(let s=0; s < num_series; s++) {
      let cur_series = data[s]
      cur_series.sort_idx = s;
      /*
      let last_point = cur_series.data[cur_series.data.length-1];
      let max_time = Math.max(last_point.time, last_point.score/points_per_hour)
      let max_score = Math.max(last_point.score, last_point.time*points_per_hour)
      data.push({
        start: data[s].start,
        sort_idx: s,
        fit: true,
        last: last_point,
        data: [{time:0,score:0},{time:last_point.time,score:last_point.time*points_per_hour}]
      })
      */
    }
    //data.sort((a, b) => (a.sort_idx == b.sort_idx) ? (!!b.fit - !!a.fit) : (a.sort_idx - b.sort_idx));

    let x = d3.scaleLinear()
      .domain([0, d3.max(data, d => d3.max(d.data, d => d.time))])
      .range([margin, width - margin])

    let y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d3.max(d.data, d=> d.score))]).nice()
//      .domain([-10000, 10000]).nice()
      .range([height - margin, margin])

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
      let a = d3.select(this).call(axis)
      a.select(".domain")
        .attr("stroke-dasharray", "5 10")
        .attr("stroke", "#666")
      a.selectAll(".tick").remove()
      /*
      attr("transform", function() {
        return d3.select(this).attr("transform") + ` rotate(${270-rot_deg})`
      })
      */
    }
    let color = d3.scaleOrdinal(d3.schemePaired)
      .domain(d3.map(data, d => d.start).keys())
    
    // x axis
    chart.append("g")
      .attr("transform", `translate(0,${height - margin})`)
      .call(d3.axisBottom(x).ticks(width / 80).tickSizeOuter(0))

    // y axes
    chart.append("g")
      .selectAll("g")
      .data(data)
      .enter().append("g")
        .attr("transform", d => `translate(0,${y(0) - y((d.sort_idx-num_series+1)*separation)}) rotate(${90+rot_deg},${x(0)},${y(0)}) translate(${margin},0)`)
        .each(axisSlanted)
    
    // line
    let line = d3.line()
      .defined(d => !isNaN(d.score))
      .x(d => x(d.time))
      .y((d, i) => y(d.score))
    
    // data it up 
    chart.append("g").selectAll("path")
      .data(data)
      .enter().append("path")
      .attr("class", "line")
      .attr("fill", "none")
      .attr("stroke", (d, i) => d.fit ? '#666' : color(i))
      .attr("stroke-width", d => d.fit ? 1 : 1.5)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("stroke-dasharray", d => d.fit ? "5 10" : "")
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
        
        console.log(d)
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

    // keep a reference to all our lines
    var lines = document.getElementsByClassName('line');

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
        .style("display", "");

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
        d3.select(".mouse-line")
          .style("opacity", "0");
        d3.selectAll(".mouse-per-line")
          .style("display", "none");
      })
      .on('mouseover', function() { // on mouse in show line, circles and text
        d3.select(".mouse-line")
          .style("opacity", "1");
        d3.selectAll(".mouse-per-line")
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
    
    
  };
  dreamRequest.open('get', '/scores');
  dreamRequest.send();
  
  let voteRequest = new XMLHttpRequest();
  voteRequest.onload = function() {
    let indata = JSON.parse(this.responseText)
    
    let minmax = (domain, value) => {
      if(!domain[0] || domain[0] > value) { domain[0] = value; }
      if(!domain[1] || domain[1] < value) { domain[1] = value; }
    }
    
    let dtime = []
    let dratio = []
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
    }
    console.log(indata)
    console.log(dratio)
    console.log(dtime)
    
    let width = 1000;
    let height = 200;
    let margin = 20;
    
    let container = d3.select('#votes')
    let chart = container.append('svg')
      .attr('width', width)
      .attr('height', height);
    
    let tooltip = container.append('div')
      .attr('class','tooltip')
    
    let x = d3.scaleTime()
      .domain(dtime)
      .range([margin, width-margin*2])
    
    let y = d3.scaleLinear()
      .domain([0,dratio[1]])
      .range([height-margin*2, margin])
    
    let xAxis = d3.axisBottom(x)
    
    let voteFormat = d3.timeFormat("%e %b %H:%M")

    // bar width, in ms
    let barwidth = x((20*60*1000)*0.9)-x(0);
    chart.append("g")
      .attr("transform", `translate(0,${margin})`)
      .attr("class", "bars")
      .selectAll("rect")
      .data(indata)
      .enter()
        .append("rect")
          .attr("width", barwidth)
          .attr("height", d => Math.abs(y(d.ratio) - y(0)))
          .attr("transform", d => `translate(${x(d.timestamp)-barwidth/2},${y(d.ratio)})`)

    chart.append("g")
      .attr("transform", `translate(0,${margin})`)
      .attr("class", "shadowbars")
      .selectAll("rect")
      .data(indata)
      .enter()
        .append("rect")
          .attr("width", barwidth)
          .attr("height", height)
          .attr("opacity", "0")
          .attr("transform", d => `translate(${x(d.timestamp)-barwidth/2},0)`)
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
  
    chart.append("g")
      .attr("transform", `translate(0,${height-margin})`)
      .call(xAxis)
  }
  voteRequest.open('get', '/votes');
  voteRequest.send();
})()

function getPosition(ctx) {
  let rel = ctx.getBoundingClientRect();
  return {
    x: rel.x + window.pageXOffset,
    y: rel.y + window.pageYOffset
  }
}
