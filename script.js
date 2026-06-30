document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{const id=a.getAttribute('href');const el=document.querySelector(id);if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth',block:'start'});}}));
const cards=[...document.querySelectorAll('.proof-card,.role-panel,.pilot-grid div,.metrics div')];
const io=new IntersectionObserver(entries=>entries.forEach(en=>{if(en.isIntersecting){en.target.animate([{opacity:.2,transform:'translateY(18px)'},{opacity:1,transform:'translateY(0)'}],{duration:550,easing:'cubic-bezier(.2,.8,.2,1)',fill:'both'});io.unobserve(en.target)}}),{threshold:.15});
cards.forEach(c=>io.observe(c));
