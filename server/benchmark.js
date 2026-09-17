const axios = require('axios');

const SENTENCE_POOL = [
  "第一句话。", "这是一个测试。", "欢迎来到我们的系统。", "明天见。",
  "你好，世界。", "我很喜欢这本书。", "他跑得很快。", "请给我一杯水。",
  "今天天气很好。", "我正在学习编程。", "时间就是金钱。", "她是一个好老师。",
  "我们去公园散步吧。", "这个菜很好吃。", "你的电话号码是多少？", "他昨天没来上班。",
  "祝你生日快乐！", "我的电脑坏了。", "我们需要更多的资源。", "感谢你的帮助。"
];

async function runBenchmark(size) {
  const sentences = Array.from({ length: size }, (_, i) => SENTENCE_POOL[i % SENTENCE_POOL.length]);

  console.log(`Starting benchmark for ${sentences.length} sentences...`);
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  const latencies = [];
  
  // Create an array of promises to simulate concurrency = 3 like the frontend queue
  const CONCURRENCY = 3;
  let index = 0;
  
  async function worker() {
    while (index < sentences.length) {
      const i = index++;
      const text = sentences[i];
      const reqStart = Date.now();
      try {
        const res = await axios.post('http://localhost:3000/api/translate', {
          text,
          sourceLanguage: 'zh-CN',
          targetLanguage: 'vi'
        }, { timeout: 10000 });
        const latency = Date.now() - reqStart;
        latencies.push(latency);
        successCount++;
      } catch (e) {
        failCount++;
        const latency = Date.now() - reqStart;
        latencies.push(latency);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }
  
  await Promise.all(workers);

  const totalTime = Date.now() - startTime;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  
  latencies.sort((a, b) => a - b);
  const p95Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
  const p50Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.50)] : 0;

  console.log('\n--- BENCHMARK RESULTS ---');
  console.log(`Total Sentences: ${sentences.length}`);
  console.log(`Success: ${successCount} (${((successCount/size)*100).toFixed(1)}%)`);
  console.log(`Failed: ${failCount}`);
  console.log(`Total Time: ${totalTime}ms`);
  console.log(`Average Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`P50 Latency: ${p50Latency}ms`);
  console.log(`P95 Latency: ${p95Latency}ms`);
  console.log(`Max Concurrency: ${CONCURRENCY}`);
}

const size = parseInt(process.argv[2]) || 20;
runBenchmark(size);

