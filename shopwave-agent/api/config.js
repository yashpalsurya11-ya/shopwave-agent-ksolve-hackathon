export default function handler(request, response) {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  
  // Set CORS headers just in case
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET');
  
  response.status(200).json({
    backendUrl: backendUrl
  });
}
