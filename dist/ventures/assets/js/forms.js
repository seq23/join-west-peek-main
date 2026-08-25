(function(){
  function onSubmit(form){
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      const status = form.querySelector('[data-form-status]');
      if(status){ status.textContent = 'Sending…'; }
      const data = new FormData(form);
      try{
        const res = await fetch(form.getAttribute('action') || '/api/lead', {
          method: 'POST',
          body: data,
          headers: { 'Accept': 'application/json' }
        });
        if(res.ok){
          if(status){ status.textContent = 'Received. We’ll reply soon.'; }
          form.reset();
        }else{
          if(status){ status.textContent = 'Could not send via form right now. Please email scooter@westpeek.ventures.'; }
        }
      }catch(err){
        if(status){ status.textContent = 'Could not send via form right now. Please email scooter@westpeek.ventures.'; }
      }
    });
  }
  document.addEventListener('DOMContentLoaded', function(){
    document.querySelectorAll('form[data-westpeek-form]').forEach(onSubmit);
  });
})();
