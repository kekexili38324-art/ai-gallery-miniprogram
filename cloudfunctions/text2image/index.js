const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// Qwen-Image-3.0 API 配置
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const BASE_URL = 'https://maas.qianwenaiapi.com/api/v1';

// 云函数入口函数
exports.main = async (event, context) => {
  const { action } = event;

  try {
    switch (action) {
      case 'createTask':
        return await createTask(event);
      case 'getResult':
        return await getTaskResult(event);
      default:
        return {
          success: false,
          error: '未知的操作类型'
        };
    }
  } catch (error) {
    console.error('云函数执行错误:', error);
    return {
      success: false,
      error: error.message || '服务器内部错误'
    };
  }
};

// 创建文生图任务（异步模式）
async function createTask(data) {
  const { prompt, negativePrompt, promptExtend = true } = data;

  if (!prompt) {
    return {
      success: false,
      error: '提示词不能为空'
    };
  }

  try {
    let fullPrompt = prompt;
    if (negativePrompt) {
      fullPrompt = prompt + '\n\n不希望出现的内容：' + negativePrompt;
    }

    const requestData = {
      model: 'qwen-image-3.0',
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                text: fullPrompt
              }
            ]
          }
        ]
      },
      parameters: {
        prompt_extend: promptExtend
      }
    };

    const response = await axios.post(
      BASE_URL + '/services/aigc/image-generation/generation',
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + DASHSCOPE_API_KEY,
          'X-DashScope-Async': 'enable'
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.output && response.data.output.task_id) {
      return {
        success: true,
        data: {
          taskId: response.data.output.task_id,
          taskStatus: response.data.output.task_status,
          requestId: response.data.request_id
        }
      };
    } else {
      return {
        success: false,
        error: (response.data && response.data.message) || '创建任务失败，响应格式异常'
      };
    }
  } catch (error) {
    console.error('创建任务失败:', (error.response && error.response.data) || error.message);
    return {
      success: false,
      error: (error.response && error.response.data && error.response.data.message) || error.message || '创建任务失败'
    };
  }
}

// 查询任务结果
async function getTaskResult(data) {
  const { taskId } = data;

  if (!taskId) {
    return {
      success: false,
      error: '任务ID不能为空'
    };
  }

  try {
    const response = await axios.get(
      BASE_URL + '/tasks/' + taskId,
      {
        headers: {
          'Authorization': 'Bearer ' + DASHSCOPE_API_KEY
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.output) {
      const output = response.data.output;
      var imageUrls = [];

      // Qwen-Image-3.0 异步模式响应格式：output.choices[].message.content[].image
      if (output.choices) {
        for (var i = 0; i < output.choices.length; i++) {
          var contents = output.choices[i].message && output.choices[i].message.content;
          if (contents && Array.isArray(contents)) {
            for (var j = 0; j < contents.length; j++) {
              if (contents[j].image) {
                imageUrls.push(contents[j].image);
              }
            }
          }
        }
      }

      // 兼容旧版格式：output.results[].url
      if (output.results) {
        for (var k = 0; k < output.results.length; k++) {
          if (output.results[k].url) {
            imageUrls.push(output.results[k].url);
          }
        }
      }

      // 任务成功时，将图片转存到云存储，返回 fileID
      if (output.task_status === 'SUCCEEDED' && imageUrls.length > 0) {
        var fileIDs = [];
        for (var m = 0; m < imageUrls.length; m++) {
          try {
            var imgResp = await axios.get(imageUrls[m], {
              responseType: 'arraybuffer',
              timeout: 15000
            });
            var fileName = 'ai-images/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.png';
            var uploadRes = await cloud.uploadFile({
              cloudPath: fileName,
              fileContent: Buffer.from(imgResp.data)
            });
            fileIDs.push(uploadRes.fileID);
          } catch (uploadError) {
            console.error('转存图片失败:', uploadError.message);
            // 转存失败时回退使用原始 URL
            fileIDs.push(imageUrls[m]);
          }
        }

        return {
          success: true,
          data: {
            taskId: output.task_id,
            status: output.task_status,
            fileIDs: fileIDs,
            imageUrls: imageUrls,
            requestId: response.data.request_id
          }
        };
      }

      return {
        success: true,
        data: {
          taskId: output.task_id,
          status: output.task_status,
          imageUrls: imageUrls,
          requestId: response.data.request_id
        }
      };
    } else {
      return {
        success: false,
        error: (response.data && response.data.message) || '查询结果失败，响应格式异常'
      };
    }
  } catch (error) {
    console.error('查询任务结果失败:', (error.response && error.response.data) || error.message);
    return {
      success: false,
      error: (error.response && error.response.data && error.response.data.message) || error.message || '查询任务结果失败'
    };
  }
}
