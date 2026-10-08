// create.ts
import { Toast } from 'tdesign-miniprogram';

Page({
  data: {
    prompt: '',
    negativePrompt: '',
    isGenerating: false,
    theme: 'light' as 'light' | 'dark',
    commonTags: ['写实', '动漫', '电影感', '梦幻', '科幻', '水彩', '赛博朋克', '油画'],
  },

  onLoad() {
    const app = getApp();
    this.setData({ theme: app.globalData.theme });
  },

  onPromptChange(e: any) {
    this.setData({
      prompt: e.detail.value
    });
  },

  onNegativePromptChange(e: any) {
    this.setData({
      negativePrompt: e.detail.value
    });
  },

  onTagTap(e: any) {
    const tag = e.currentTarget.dataset.tag;
    this.setData({
      prompt: this.data.prompt ? `${this.data.prompt}，${tag}` : tag
    });
  },

  showInspirationDialog() {
    Toast({
      context: this,
      selector: '#t-toast',
      message: '灵感功能开发中...',
    });
  },

  async onGenerateTap() {
    if (!this.data.prompt) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请输入提示词',
        theme: 'error',
      });
      return;
    }

    this.setData({ isGenerating: true });

    Toast({
      context: this,
      selector: '#t-toast',
      message: '正在创建生成任务...',
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
          Toast({
            context: this,
            selector: '#t-toast',
            message: '任务创建成功，正在跳转...',
            theme: 'success',
          });

          setTimeout(() => {
            wx.navigateTo({
              url: `/pages/result/result?taskId=${taskId}&prompt=${encodeURIComponent(this.data.prompt)}&negativePrompt=${encodeURIComponent(this.data.negativePrompt)}`,
              success: () => {
                this.setData({ isGenerating: false });
              }
            });
          }, 1000);
        } else {
          this.setData({ isGenerating: false });
          Toast({
            context: this,
            selector: '#t-toast',
            message: '任务ID获取失败',
            theme: 'error',
          });
        }
      } else {
        this.setData({ isGenerating: false });
        Toast({
          context: this,
          selector: '#t-toast',
          message: cloudResult?.error || '创建任务失败',
          theme: 'error',
        });
      }
    } catch (error) {
      console.error('调用云函数失败:', error);
      wx.hideToast();
      this.setData({ isGenerating: false });

      Toast({
        context: this,
        selector: '#t-toast',
        message: '网络错误，请重试',
        theme: 'error',
      });
    }
  },

  onThemeToggle() {
    const app = getApp();
    app.toggleTheme();
  },

  onThemeChange(theme: 'light' | 'dark') {
    this.setData({ theme });
  }
});
