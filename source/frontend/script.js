// fetch to get data and populate table
fetch("http://127.0.0.1:8800/api/view")
    .then(r => r.json())
    .then(data => {
        const tbody = document.getElementById("data")
        data.forEach(r => {
            tbody.insertAdjacentHTML("beforeend", `
        <tr>
          <td>${r.id}</td>
          <td>${r.timestamp}</td>
          <td>${r.agent_id}</td>
          <td>${r.event_type}</td>
          <td>${r.boot}</td>
          <td>${r.bin}</td>
          <td>${r.sbin}</td>
          <td>${r.etc}</td>
          <td>${r.root}</td>
        </tr>`)
        })
    })
