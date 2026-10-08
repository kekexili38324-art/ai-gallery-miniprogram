// index.ts
import { Toast } from 'tdesign-miniprogram';

Page({
  data: {
    imageList: [] as Array<{
      id: string;
      imageUrl: string;
      prompt: string;
      showSaveHint?: boolean;
    }>,
    isLoading: false,
    hasMore: true,
    page: 1,
    theme: 'light' as 'light' | 'dark',
    fabButton: {
      theme: 'primary',
      size: 'large',
    },
  },

  onLoad() {
    const app = getApp();
    this.setData({ theme: app.globalData.theme });
    this.updatePageTheme(app.globalData.theme);
    this.loadImages();
  },

  onPullDownRefresh() {
    this.setData({
      imageList: [],
      page: 1,
      hasMore: true,
    });
    this.loadImages(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.isLoading) {
      this.loadImages();
    }
  },

  loadImages(callback?: () => void) {
    if (this.data.isLoading || !this.data.hasMore) {
      callback?.();
      return;
    }

    this.setData({ isLoading: true });

    const db = wx.cloud.database();
    const pageSize = 6;
    const skip = (this.data.page - 1) * pageSize;

    const timeoutId = setTimeout(() => {
      console.error('加载图片超时');
      this.setData({ isLoading: false });
      wx.showToast({
        title: '加载超时，请检查网络连接',
        icon: 'none',
      });
      callback?.();
    }, 10000);

    db.collection('images')
      .where({
        isPublic: true
      })
      .orderBy('createTime', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get({
        success: async (res) => {
          clearTimeout(timeoutId);

          // 收集需要转换的 fileID
          const fileIDList: string[] = [];
          const rawImages = res.data.map((item: any) => {
            const imageUrl: string = item.imageUrl;
            if (imageUrl && imageUrl.startsWith('cloud://')) {
              fileIDList.push(imageUrl);
            }
            return {
              id: item._id,
              imageUrl: imageUrl,
              prompt: item.prompt,
              createTime: item.createTime
            };
          });

          // 批量转换 cloud:// fileID 为临时 URL
          if (fileIDList.length > 0) {
            try {
              const tempRes = await wx.cloud.getTempFileURL({ fileList: fileIDList });
              const urlMap: Record<string, string> = {};
              for (const f of tempRes.fileList) {
                if (f.tempFileURL) {
                  urlMap[f.fileID] = f.tempFileURL;
                }
              }
              for (const img of rawImages) {
                if (img.imageUrl in urlMap) {
                  img.imageUrl = urlMap[img.imageUrl];
                }
              }
            } catch (e) {
              console.warn('转换临时URL失败:', e);
            }
          }

          this.setData({
            imageList: [...this.data.imageList, ...rawImages],
            page: this.data.page + 1,
            isLoading: false,
            hasMore: rawImages.length === pageSize,
          });

          this.preloadImages(rawImages);
          callback?.();
        },
        fail: (error) => {
          clearTimeout(timeoutId);
          console.error('加载图片失败:', error);
          this.setData({ isLoading: false, hasMore: false });

          const errObj = error as any;
          let errorMessage = '加载失败，请重试';

          if (errObj.errCode === -1) {
            errorMessage = '网络连接失败，请检查网络';
          } else if (errObj.errCode === 10004 || (errObj.errMsg && errObj.errMsg.includes('collection'))) {
            errorMessage = '云数据库集合不存在，请在云开发控制台创建 images 集合';
          } else if (errObj.errMsg) {
            errorMessage = errObj.errMsg;
          }

          wx.showToast({
            title: errorMessage,
            icon: 'none',
            duration: 3000,
          });

          callback?.();
        }
      });
  },

  preloadImages(images: Array<{ imageUrl: string }>) {
    images.forEach((image, index) => {
      setTimeout(() => {
        wx.getImageInfo({
          src: image.imageUrl,
          success: () => {},
          fail: () => {}
        });
      }, index * 100);
    });
  },

  onCreateTap() {
    wx.navigateTo({
      url: '/pages/create/create'
    });
  },

  onImageTap(e: any) {
   const id = e.currentTarget.dataset.id;
   console.log('点击了图片:', id);
 },
 
  // 点击图片预览大图
  onImagePreview(e: any) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    // 收集当前所有图片 URL 作为预览列表
    const urls = this.data.imageList.map((img: any) => img.imageUrl).filter((u: string) => !!u);
    wx.previewImage({
      urls: urls,
      current: url,
    });
  },

  async onImageLongPress(e: any) {
    const imageUrl = e.currentTarget.dataset.url;
    const prompt = e.currentTarget.dataset.prompt;

    if (!imageUrl) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '图片地址无效',
        theme: 'error',
      });
      return;
    }

    wx.showActionSheet({
      itemList: ['保存到相册', '预览图片'],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await this.saveImageToAlbum(imageUrl, prompt);
        } else if (res.tapIndex === 1) {
          wx.previewImage({
            urls: [imageUrl],
            current: imageUrl,
          });
        }
      }
    });
  },

  async saveImageToAlbum(imageUrl: string, _prompt: string) {
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
          url: imageUrl,
          success: resolve,
          fail: reject
        });
      });

      if (downloadResult.statusCode === 200) {
        await new Promise<WechatMiniprogram.GeneralCallbackResult>((resolve, reject) => {
          wx.saveImageToPhotosAlbum({
            filePath: downloadResult.tempFilePath,
            success: resolve,
            fail: reject
          });
        });

        wx.hideToast();
        Toast({
          context: this,
          selector: '#t-toast',
          message: '图片已保存到相册',
          theme: 'success',
        });
      } else {
        throw new Error('下载图片失败');
      }
    } catch (error: any) {
      console.error('保存图片失败:', error);
      wx.hideToast();

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

  onThemeToggle() {
    const app = getApp();
    app.toggleTheme();
  },

  onThemeChange(theme: 'light' | 'dark') {
    this.setData({ theme });
    this.updatePageTheme(theme);
  },

  updatePageTheme(theme: 'light' | 'dark') {
    console.log('页面主题已更新为:', theme);
  }
});
