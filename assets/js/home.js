/* 首页题库卡片：所有科目信息统一从 data/subjects.json 读取。 */
(function () {
  const grid = document.getElementById('subjectGrid');
  if (!grid) return;

  const colorVars = {
    blue: '--blue',
    purple: '--purple',
    pink: '--pink',
    green: '--green',
    orange: '--orange',
    red: '--red'
  };

  const tagClasses = {
    blue: 'tag-b',
    purple: 'tag-p',
    pink: 'tag-pk',
    green: 'tag-g',
    orange: 'tag-o',
    red: 'tag-r'
  };

  function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function createSubjectCard(subject) {
    const colorVar = colorVars[subject.color] || '--blue';
    const tagClass = tagClasses[subject.color] || 'tag-b';
    const card = document.createElement('a');
    card.className = 'exam-card';
    card.href = 'quiz.html?subject=' + encodeURIComponent(subject.id);
    card.style.borderLeftColor = 'var(' + colorVar + ')';

    const inner = document.createElement('div');
    inner.className = 'exam-card-inner';

    const title = createTextElement('div', 'year', subject.title);
    title.style.color = 'var(' + colorVar + ')';
    inner.appendChild(title);
    inner.appendChild(createTextElement('div', 'course', subject.subtitle));

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.appendChild(createTextElement('span', 'meta-total', '📝 ' + subject.count + ' 题'));
    meta.appendChild(createTextElement('span', 'meta-score', '📋 ' + subject.summary));
    meta.appendChild(createTextElement('span', 'meta-time', '🎲 随机抽题'));
    inner.appendChild(meta);

    const tags = document.createElement('div');
    tags.className = 'tags';
    subject.tags.forEach(function (tag) {
      tags.appendChild(createTextElement('span', 'tag ' + tagClass, tag));
    });
    inner.appendChild(tags);

    card.appendChild(inner);
    card.appendChild(createTextElement('span', 'arrow', '→'));
    return card;
  }

  fetch('data/subjects.json')
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (subjects) {
      grid.replaceChildren();
      subjects.forEach(function (subject) {
        grid.appendChild(createSubjectCard(subject));
      });
      const subjectCount = document.getElementById('subjectCount');
      const questionCount = document.getElementById('questionCount');
      if (subjectCount) subjectCount.textContent = String(subjects.length);
      if (questionCount) {
        const total = subjects.reduce(function (sum, subject) {
          return sum + Number(subject.count || 0);
        }, 0);
        questionCount.textContent = String(total);
        const heroQuestionCount = document.getElementById('heroQuestionCount');
        if (heroQuestionCount) heroQuestionCount.textContent = '📝 题库练习 ' + total + '题';
      }
    })
    .catch(function () {
      grid.replaceChildren();
      const message = createTextElement('div', 'exam-card placeholder', '题库目录加载失败，请刷新页面重试。');
      message.setAttribute('role', 'alert');
      grid.appendChild(message);
    });
})();
