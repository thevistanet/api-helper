document.addEventListener("DOMContentLoaded", () => {
  const sidebarMenu = document.getElementById('sidebar-menu');
  const sectionsContainer = document.getElementById('dynamic-sections');

  // 1. โหลดข้อมูลจากไฟล์ api-config.json 
  fetch('api-config.json')
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(apiConfig => {
      // เมื่อโหลดสำเร็จ ให้นำข้อมูลไปสร้าง UI
      renderSidebar(apiConfig);
      renderSections(apiConfig);
      bindEvents(apiConfig);
    })
    .catch(error => {
      // กรณีโหลดไฟล์ไม่สำเร็จ (เช่น เปิดผ่าน file:// โดยตรง หรือพิมพ์ชื่อไฟล์ผิด)
      console.error('Error loading API config:', error);
      sidebarMenu.innerHTML = `<li class="p-3 text-danger"><small><i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถโหลดเมนูได้</small></li>`;
      sectionsContainer.innerHTML = `<div class="alert alert-danger">
        <h5 class="fw-bold"><i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถโหลดไฟล์ api-config.json ได้</h5>
        <p class="mb-0">รายละเอียด: ${error.message}</p>
        <hr>
        <p class="mb-0 fs-6"><b>หมายเหตุ:</b> การใช้ fetch() ดึงไฟล์ JSON จำเป็นต้องรันผ่าน Web Server (เช่น http://localhost) หากเปิดไฟล์ index.html โดยตรง (file:///) เบราว์เซอร์จะบล็อกด้วยเหตุผลด้านความปลอดภัย</p>
      </div>`;
    });

  // ---------------------------------------------------------
  // ฟังก์ชันส่วนประกอบต่างๆ (รับค่า apiConfig มาจากตอน Fetch)
  // ---------------------------------------------------------

  // ฟังก์ชันสร้าง Sidebar Navigation Grouped by Category
  function renderSidebar(apiConfig) {
    const categories = [...new Set(apiConfig.map(item => item.category))];
    
    categories.forEach(category => {
      sidebarMenu.insertAdjacentHTML('beforeend', `<div class="category-label">${category}</div>`);
      
      const items = apiConfig.filter(item => item.category === category);
      items.forEach((item, index) => {
        // ให้เมนูแรกของหมวดแรกถูกเลือกเป็นค่าเริ่มต้น
        const isActive = (category === categories[0] && index === 0) ? 'active' : '';
        const li = document.createElement('li');
        li.innerHTML = `<a class="nav-link ${isActive}" data-target="${item.id}">${item.title}</a>`;
        sidebarMenu.appendChild(li);
      });
    });
  }

  // ฟังก์ชันสร้าง Form UI
  function renderSections(apiConfig) {
    apiConfig.forEach((api, index) => {
      const isActive = index === 0 ? 'active' : '';
      let formHtml = `<div class="row g-3 align-items-end mb-4">`;

      if(api.fields && api.fields.length > 0) {
        api.fields.forEach(field => {
          formHtml += `<div class="${field.col || 'col-md-3'}">
            <label class="form-label">${field.label}</label>`;
          
          if (field.type === 'select') {
            formHtml += `<select class="form-select api-input" data-id="${field.id}" data-query="${field.query || ''}" data-ispath="${field.isPath || false}">`;
            field.options.forEach(opt => {
              formHtml += `<option value="${opt.val}">${opt.text}</option>`;
            });
            formHtml += `</select>`;
          } else {
            formHtml += `<input type="${field.type}" class="form-control api-input" data-id="${field.id}" data-query="${field.query || ''}" placeholder="${field.placeholder || ''}">`;
          }
          formHtml += `</div>`;
        });
      }

      formHtml += `
        <div class="col-12 mt-4">
          <button class="btn btn-primary btn-submit" data-apid="${api.id}">Execute API Request</button>
        </div>
      </div>`;

      const sectionHtml = `
        <div class="api-card ${isActive}" id="${api.id}">
          <h4 class="mb-4 fw-bold border-bottom pb-2">${api.title} 
            <small class="text-muted fs-6 fw-normal ms-2">
              <span class="badge ${api.method === 'GET' ? 'bg-success' : 'bg-warning text-dark'} me-1">${api.method}</span>
              ${api.endpoint}
            </small>
          </h4>
          ${formHtml}
          <div class="output-container mt-4" id="out_${api.id}"></div>
        </div>
      `;
      sectionsContainer.insertAdjacentHTML('beforeend', sectionHtml);
    });
  }

  // ฟังก์ชันจัดการ Event
  function bindEvents(apiConfig) {
    // สลับหน้า Sidebar
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
        e.target.classList.add('active');
        
        document.querySelectorAll('.api-card').forEach(card => card.classList.remove('active'));
        document.getElementById(e.target.getAttribute('data-target')).classList.add('active');
      });
    });

    // ปุ่ม Execute API
    document.querySelectorAll('.btn-submit').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const apiId = e.target.getAttribute('data-apid');
        const config = apiConfig.find(a => a.id === apiId);
        const section = document.getElementById(apiId);
        const outputDiv = document.getElementById(`out_${apiId}`);
        const baseUrl = document.getElementById('global-url').value;
        const session = document.getElementById('session-val').value;

        let endpoint = config.endpoint;
        const queryParams = new URLSearchParams();
        if(session) queryParams.append('s', session);

        // ดึงค่าจากฟอร์ม
        section.querySelectorAll('.api-input').forEach(input => {
          const val = input.value;
          if (input.dataset.ispath === 'true') {
            endpoint = endpoint.replace(`{${input.dataset.id}}`, val);
          } else if (input.dataset.query && val !== '') {
            queryParams.append(input.dataset.query, val);
          }
        });

        // สร้าง URL ปลายทาง
        const queryString = queryParams.toString();
        const finalUrl = `${baseUrl}${endpoint}${queryString ? '?' + queryString : ''}`;
        
        outputDiv.innerHTML = `<div class="alert alert-info py-2 mb-2">Fetching: <a href="${finalUrl}" target="_blank">${finalUrl}</a><br><div class="spinner-border spinner-border-sm mt-2"></div></div>`;

        // ตัวอย่างการจำลองการยิง API (ถ้าต้องการยิงจริงให้แทนที่ด้วย fetch() ปกติ)
        try {
          const mockResponse = { status: "success", requested_url: finalUrl, method: config.method, timestamp: new Date() };
          setTimeout(() => {
            outputDiv.innerHTML = `<div class="alert alert-success py-2 mb-2"><i class="fa-solid fa-check"></i> URL: ${finalUrl}</div>
                                   <pre class="json-output"><code>${JSON.stringify(mockResponse, null, 2)}</code></pre>`;
          }, 500);
        } catch (error) {
          outputDiv.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
        }
      });
    });
  }
});
