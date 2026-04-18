export default function (req, res) {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');
  
  res.statusCode = 200;
  res.end(JSON.stringify({ backendUrl }));
}
