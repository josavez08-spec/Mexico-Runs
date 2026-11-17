(()=>{
  const photos=[
    {match:'aveo',file:'chevrolet-aveo.jpg'},
    {match:'march',file:'nissan-march.jpg'},
    {match:'versa',file:'nissan-versa.jpg',catalogFile:'nissan-versa-catalogo.webp'},
    {match:'vento',file:'volkswagen-vento.jpg'},
    {match:'cx5',file:'mazda-cx5.jpg'},
    {match:'hiace',file:'toyota-hiace.jpg'},
    {match:'serie3',file:'bmw-serie-3.jpg'},
    {match:'rio',file:'kia-rio.jpg'},
    {match:'creta',url:'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3f/Hyundai_Creta.jpg/960px-Hyundai_Creta.jpg'}
  ];
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  window.MRVehicleImages={resolve(vehicle,section='home'){
    const provided=vehicle?.imagen||vehicle?.foto||vehicle?.url_imagen;
    if(provided)return provided;
    const name=normalize([vehicle?.marca,vehicle?.modelo,vehicle?.nombre].filter(Boolean).join(' '));
    const photo=photos.find(item=>name.includes(item.match));
    if(!photo)return '';
    const file=section==='catalog'&&photo.catalogFile?photo.catalogFile:photo.file;
    return photo.url||`assets/vehicles/${file}`;
  }};
})();
