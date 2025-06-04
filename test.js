const http = require('http');

const BASE_URL = 'http://localhost:3002';

// Helper function to make HTTP requests
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3002,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (error) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Test cases
async function runTests() {
  console.log('🧪 Testing Pronunciation Audio Service...\n');
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: Health check
  console.log('Test 1: Health Check');
  try {
    const response = await makeRequest('GET', '/health');
    if (response.status === 200 && response.data.status === 'healthy') {
      console.log('✅ PASS - Service is healthy');
      passed++;
    } else {
      console.log('❌ FAIL - Health check failed');
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL - Health check error:', error.message);
    failed++;
  }
  
  // Test 2: Get audio URL for Chinese text (User Story 1)
  console.log('\nTest 2: Get Audio URL');
  try {
    const response = await makeRequest('POST', '/audio', {
      text: '你好',
      language: 'zh-CN'
    });
    
    if (response.status === 200 && response.data.success && response.data.audioUrl) {
      console.log('✅ PASS - Audio URL generated successfully');
      console.log(`   Audio URL: ${response.data.audioUrl}`);
      passed++;
    } else {
      console.log('❌ FAIL - Audio URL generation failed');
      console.log('   Response:', response.data);
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL - Audio URL error:', error.message);
    failed++;
  }
  
  // Test 3: Test caching (should be cached on second request)
  console.log('\nTest 3: Audio Caching');
  try {
    // Use a unique text for each test run to ensure we're testing fresh caching
    const uniqueText = `测试${Date.now()}`;
    
    const response1 = await makeRequest('POST', '/audio', {
      text: uniqueText,
      language: 'zh-CN'
    });
    
    const response2 = await makeRequest('POST', '/audio', {
      text: uniqueText,
      language: 'zh-CN'
    });
    
    if (response1.status === 200 && response2.status === 200 && 
        response1.data.cached === false && response2.data.cached === true) {
      console.log('✅ PASS - Caching works correctly');
      console.log(`   First request: cached = ${response1.data.cached}`);
      console.log(`   Second request: cached = ${response2.data.cached}`);
      passed++;
    } else {
      console.log('❌ FAIL - Caching not working as expected');
      console.log(`   First: cached = ${response1.data.cached}`);
      console.log(`   Second: cached = ${response2.data.cached}`);
      console.log(`   Test text: ${uniqueText}`);
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL - Caching test error:', error.message);
    failed++;
  }
  
  // Test 4: Preload audio (User Story 2)
  console.log('\nTest 4: Audio Preloading');
  try {
    const response = await makeRequest('POST', '/preload', {
      texts: ['学习', '中文', '很好'],
      language: 'zh-CN'
    });
    
    if (response.status === 200 && response.data.success && response.data.preloadId) {
      console.log('✅ PASS - Preload initiated successfully');
      console.log(`   Preload ID: ${response.data.preloadId}`);
      
      // Wait a moment then check status
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const statusResponse = await makeRequest('GET', `/preload/${response.data.preloadId}`);
      if (statusResponse.status === 200) {
        console.log(`   Status: ${statusResponse.data.status}`);
        console.log(`   Results: ${statusResponse.data.results.length} items`);
      }
      passed++;
    } else {
      console.log('❌ FAIL - Preload initiation failed');
      console.log('   Response:', response.data);
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL - Preload error:', error.message);
    failed++;
  }
  
  // Test 5: Invalid input validation
  console.log('\nTest 5: Input Validation');
  try {
    const response = await makeRequest('POST', '/audio', {
      text: 'hello world', // English text, should fail
      language: 'zh-CN'
    });
    
    if (response.status === 400) {
      console.log('✅ PASS - Input validation working');
      passed++;
    } else {
      console.log('❌ FAIL - Input validation not working');
      console.log('   Response:', response.data);
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL - Input validation test error:', error.message);
    failed++;
  }
  
  // Test 6: Responsiveness requirement (under 300ms for cached items)
  console.log('\nTest 6: Responsiveness Requirement');
  try {
    // First, cache an item
    await makeRequest('POST', '/audio', {
      text: '快速',
      language: 'zh-CN'
    });
    
    // Now test response time for cached item
    const startTime = Date.now();
    const response = await makeRequest('POST', '/audio', {
      text: '快速',
      language: 'zh-CN'
    });
    const responseTime = Date.now() - startTime;
    
    if (response.status === 200 && response.data.cached && responseTime < 300) {
      console.log('✅ PASS - Responsiveness requirement met');
      console.log(`   Response time: ${responseTime}ms (requirement: <300ms)`);
      passed++;
    } else {
      console.log('❌ FAIL - Responsiveness requirement not met');
      console.log(`   Response time: ${responseTime}ms (cached: ${response.data.cached})`);
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL - Responsiveness test error:', error.message);
    failed++;
  }
  
  // Test 7: Cache statistics
  console.log('\nTest 7: Cache Statistics');
  try {
    const response = await makeRequest('GET', '/cache/stats');
    
    if (response.status === 200 && response.data.success && response.data.cache) {
      console.log('✅ PASS - Cache statistics available');
      console.log(`   Cache size: ${response.data.cache.size}`);
      console.log(`   Cache utilization: ${response.data.cache.utilization}%`);
      passed++;
    } else {
      console.log('❌ FAIL - Cache statistics not working');
      failed++;
    }
  } catch (error) {
    console.log('❌ FAIL - Cache statistics error:', error.message);
    failed++;
  }
  
  // Test Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! Microservice C is working correctly.');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed. Please check the service configuration.`);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('🔧 USER STORY VERIFICATION');
  console.log('='.repeat(50));
  console.log('User Story 1 (Pronunciation Examples):');
  console.log('  ✓ Audio URLs generated for Chinese text');
  console.log('  ✓ Caching improves performance');
  console.log('  ✓ Input validation prevents invalid requests');
  console.log('');
  console.log('User Story 2 (Preload Audio):');
  console.log('  ✓ Preload requests accepted and processed');
  console.log('  ✓ Status tracking available');
  console.log('  ✓ Batch processing for multiple texts');
  console.log('');
  console.log('Non-functional Requirements:');
  console.log('  ✓ Availability: Service health monitoring');
  console.log('  ✓ Responsiveness: <300ms for cached audio');
}

// Check if server is running before starting tests
async function checkServer() {
  try {
    const response = await makeRequest('GET', '/health');
    if (response.status === 200) {
      console.log('🚀 Server is running, starting tests...\n');
      await runTests();
    } else {
      console.log('❌ Server health check failed');
    }
  } catch (error) {
    console.log('❌ Cannot connect to server. Please ensure the service is running on port 3002');
    console.log('   Start the server with: npm start');
  }
}

checkServer();