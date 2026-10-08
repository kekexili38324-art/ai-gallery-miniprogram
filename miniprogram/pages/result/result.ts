// result.ts
import { Toast } from 'tdesign-miniprogram';

Page({
  data: {
    prompt: '',
    negativePrompt: '',
    taskId: '',
    imageUrl: '',
    fileID: '',
    isLoading: true,
    isRegenerating: false,
    isPublishing: false,
    isSaving: false,
    taskStatus: '',
    errorMessage: '',
    pollTimer: null as any,
    pollCount: 0,
    theme: 'light' as 'light' | 'dark',
  },

  onLoad(options: any) {
    const app = getApp();
    this.setData({ theme: app.globalData.theme });

    if (options.prompt) {
      this.setData({
        prompt: decodeURIComponent(options.prompt),
        negativePrompt: options.negativePrompt ? decodeURIComponent(options.negativePrompt) : '',
        taskId: options.taskId || '',
      });
    }

    if (this.data.taskId) {
      this.startPolling();
    } else {
      this.setData({
        isLoading: false,
        errorMessage: '缺少任务ID'
      });
    }
  },

  onUnload() {
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
    }
  },

  startPolling() {
    this.setData({ pollCount: 0 });
    this.queryTaskResult();
    const timer = setInterval(() => {
      this.queryTaskResult();
    }, 5000);
    this.setData({ pollTimer: timer });
  },

  clearTimer() {
    if (this.data.pollTimer) {
      clearInterval(this.data.pollTimer);
      this.setData({ pollTimer: null });
    }
  },

  async queryTaskResult() {
    if (this.data.pollCount >= 60) {
      this.clearTimer();
      this.setData({
        isLoading: false,
        errorMessage: '生成超时（超过5分钟），请重试'
      });
      return;
    }

    this.setData({ pollCount: this.data.pollCount + 1 });

    try {
      const result = await wx.cloud.callFunction({
        name: 'text2image',
        data: {
          action: 'getResult',
          taskId: this.data.taskId
        }
      });

      const cloudResult = result.result as any;
      if (cloudResult && cloudResult.success) {
        const taskData = cloudResult.data;
        const status = taskData?.status;

        this.setData({ taskStatus: status || '' });

        if (status === 'SUCCEEDED') {
          const fileIDs = taskData?.fileIDs;
          if (fileIDs && fileIDs.length > 0) {
            const fileID = fileIDs[0];
            // cloud:// 开头的是云存储 fileID，需要转成临时 URL
            if (fileID.startsWith('cloud://')) {
              this.setData({ fileID: fileID });
              const tempRes = await wx.cloud.getTempFileURL({
                fileList: [fileID]
              });
              if (tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL) {
                this.setData({
                  imageUrl: tempRes.fileList[0].tempFileURL,
                  isLoading: false,
                  errorMessage: ''
                });
              } else {
                this.setData({
                  isLoading: false,
                  errorMessage: '获取图片链接失败'
                });
              }
            } else {
              // 转存失败的回退情况，直接使用原始 URL
              this.setData({
                imageUrl: fileID,
                fileID: '',
                isLoading: false,
                errorMessage: ''
              });
            }
            this.clearTimer();
          } else {
            this.setData({
              isLoading: false,
              errorMessage: '未获取到图片'
            });
            this.clearTimer();
          }
        } else if (status === 'FAILED') {
          this.setData({
            isLoading: false,
            errorMessage: '图片生成失败，请重试'
          });
          this.clearTimer();
        } else if (status === 'PENDING' || status === 'RUNNING') {
          this.setData({
            isLoading: true,
            errorMessage: ''
          });
        }
      }
    } catch (error) {
      console.error('查询任务结果异常:', error);
    }
  },

  previewImage() {
    if (this.data.imageUrl) {
      wx.previewImage({
        urls: [this.data.imageUrl],
        current: this.data.imageUrl,
      });
    }
  },

  async onRegenerateTap() {
    if (this.data.isRegenerating) return;

    this.setData({ isRegenerating: true });

    Toast({
      context: this,
      selector: '#t-toast',
      message: '正在创建新任务...',
      theme: 'loading',
      direction: 'column',
      duration: 0,
    });

    try {
      const result = await wx.cloud.callFunction({
        name: 'text2image',
        data: {
          action: 'createTask',
          prompt: this.data.prompt,
          negativePrompt: this.data.negativePrompt,
        }
      });

      wx.hideToast();

      const cloudResult = result.result as any;
      if (cloudResult && cloudResult.success) {
        const taskId = cloudResult.data?.taskId;
        if (taskId) {
          this.clearTimer();
          this.setData({
            taskId: taskId,
            isLoading: true,
            isRegenerating: false,
            imageUrl: '',
            fileID: '',
            errorMessage: '',
            pollCount: 0,
          });
          this.startPolling();
        } else {
          this.setData({ isRegenerating: false });
          Toast({
            context: this,
            selector: '#t-toast',
            message: '任务ID获取失败',
            theme: 'error',
          });
        }
      } else {
        this.setData({ isRegenerating: false });
        Toast({
          context: this,
          selector: '#t-toast',
          message: cloudResult?.error || '重新生成失败',
          theme: 'error',
        });
      }
    } catch (error) {
      console.error('重新生成失败:', error);
      wx.hideToast();
      this.setData({ isRegenerating: false });
      Toast({
        context: this,
        selector: '#t-toast',
        message: '网络错误，请重试',
        theme: 'error',
      });
    }
  },

  async onPublishTap() {
    if (!this.data.imageUrl) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '没有可发布的图片',
        theme: 'error',
      });
      return;
    }

    this.setData({ isPublishing: true });

    Toast({
      context: this,
      selector: '#t-toast',
      message: '正在发布到画廊...',
      theme: 'loading',
      direction: 'column',
      duration: 0,
    });

    try {
      const loginResult = await wx.cloud.callFunction({
        name: 'login'
      });

      const openid = (loginResult.result as any)?.openid;
      if (!openid) {
        throw new Error('获取用户信息失败');
      }

      const db = wx.cloud.database();
      const imagesCollection = db.collection('images');

      // 存储 fileID（如有）或临时 URL
      const publishData = {
        openid: openid,
        imageUrl: this.data.fileID || this.data.imageUrl,
        prompt: this.data.prompt,
        negativePrompt: this.data.negativePrompt || '',
        taskId: this.data.taskId,
        createTime: new Date(),
        isPublic: true,
        likes: 0,
        views: 0,
        status: 'published'
      };

      const addResult = await imagesCollection.add({
        data: publishData
      });

      wx.hideToast();
      this.setData({ isPublishing: false });

      if (addResult._id) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '发布成功！',
          theme: 'success',
        });

        setTimeout(() => {
          wx.switchTab({
            url: '/pages/index/index'
          });
        }, 1500);
      } else {
        throw new Error('发布失败');
      }
    } catch (error) {
      console.error('发布失败:', error);
      wx.hideToast();
      this.setData({ isPublishing: false });
      Toast({
        context: this,
        selector: '#t-toast',
        message: (error as any)?.message || '发布失败，请重试',
        theme: 'error',
      });
    }
  },

  async onSaveImageTap() {
    if (!this.data.imageUrl) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '没有可保存的图片',
        theme: 'error',
      });
      return;
    }

    this.setData({ isSaving: true });

    Toast({
      context: this,
      selector: '#t-toast',
      message: '正在保存图片...',
      theme: 'loading',
      direction: 'column',
      duration: 0,
    });

    try {
      const downloadResult = await new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>((resolve, reject) => {
        wx.downloadFile({
          url: this.data.imageUrl,
          success: resolve,
          fail: reject
        });
      });

      if (downloadResult.statusCode !== 200) {
        throw new Error('下载图片失败，HTTP状态码: ' + downloadResult.statusCode);
      }

      await new Promise<WechatMiniprogram.GeneralCallbackResult>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: downloadResult.tempFilePath,
          success: resolve,
          fail: reject
        });
      });

      wx.hideToast();
      this.setData({ isSaving: false });

      Toast({
        context: this,
        selector: '#t-toast',
        message: '图片已保存到相册',
        theme: 'success',
      });
    } catch (error: any) {
      console.error('保存图片失败:', error);
      wx.hideToast();
      this.setData({ isSaving: false });

      const errMsg = error.errMsg || error.message || '';

      if (errMsg.includes('auth') || errMsg.includes('saveImageToPhotosAlbum')) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存图片需要访问您的相册，请在设置中开启权限',
          confirmText: '去设置',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          }
        });
        return;
      }

      wx.showModal({
        title: '保存失败',
        content: errMsg || '未知错误',
        showCancel: false,
      });
    }
  },

  onBackToCreate() {
    wx.navigateBack();
  },

  onThemeToggle() {
    const app = getApp();
    app.toggleTheme();
  },

  onThemeChange(theme: 'light' | 'dark') {
    this.setData({ theme });
  },
});
